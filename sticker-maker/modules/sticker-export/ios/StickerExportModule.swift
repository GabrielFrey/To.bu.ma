import ExpoModulesCore
import UIKit

/// Pasteboard contracts used by the two messengers that accept third-party sticker
/// packs. Verify against the current WhatsApp and Telegram sample apps when either
/// ships a new format; the keys below are what those samples document today.
private enum PasteboardType {
  static let whatsApp = "net.whatsapp.third-party.sticker-pack"
  static let telegram = "org.telegram.third-party.stickerset"
}

private enum AppScheme {
  static let whatsAppImport = "whatsapp://stickerPack"
  static let telegramImport = "tg://importStickers"
  static let whatsAppProbe = "whatsapp://"
  static let telegramProbe = "tg://"
}

struct WhatsAppSticker: Record {
  @Field var imageData: String = ""
  @Field var emojis: [String] = []
}

struct WhatsAppPackPayload: Record {
  @Field var identifier: String = ""
  @Field var name: String = ""
  @Field var publisher: String = ""
  @Field var trayImageData: String = ""
  @Field var stickers: [WhatsAppSticker] = []
}

struct TelegramSticker: Record {
  @Field var data: String = ""
  @Field var mimeType: String = "image/webp"
  @Field var emojis: [String] = []
}

struct TelegramPackPayload: Record {
  @Field var software: String = ""
  @Field var isAnimated: Bool = false
  @Field var thumbnailData: String?
  @Field var stickers: [TelegramSticker] = []
}

public class StickerExportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StickerExportModule")

    Function("isAppInstalled") { (app: String) -> Bool in
      let probe: String
      switch app {
      case "whatsapp": probe = AppScheme.whatsAppProbe
      case "telegram": probe = AppScheme.telegramProbe
      default: return false
      }
      guard let url = URL(string: probe) else { return false }
      return UIApplication.shared.canOpenURL(url)
    }
    .runOnQueue(.main)

    AsyncFunction("sendPackToWhatsApp") { (payload: WhatsAppPackPayload) -> Bool in
      guard payload.stickers.count >= 3, payload.stickers.count <= 30 else {
        throw InvalidPackException("WhatsApp accepts 3 to 30 stickers, got \(payload.stickers.count)")
      }

      let json: [String: Any] = [
        "identifier": payload.identifier,
        "name": payload.name,
        "publisher": payload.publisher,
        "tray_image": payload.trayImageData,
        "stickers": payload.stickers.map { sticker in
          [
            "image_data": sticker.imageData,
            "emojis": Array(sticker.emojis.prefix(3)),
          ] as [String: Any]
        },
      ]

      return try await Self.handOff(json: json, pasteboardType: PasteboardType.whatsApp, urlString: AppScheme.whatsAppImport)
    }
    .runOnQueue(.main)

    AsyncFunction("sendPackToTelegram") { (payload: TelegramPackPayload) -> Bool in
      guard !payload.stickers.isEmpty else {
        throw InvalidPackException("Telegram import needs at least one sticker")
      }

      var json: [String: Any] = [
        "software": payload.software,
        "isAnimated": payload.isAnimated,
        "stickers": payload.stickers.map { sticker in
          [
            "data": sticker.data,
            "mimeType": sticker.mimeType,
            "emojis": sticker.emojis,
          ] as [String: Any]
        },
      ]
      if let thumbnail = payload.thumbnailData {
        json["thumbnail"] = thumbnail
      }

      return try await Self.handOff(json: json, pasteboardType: PasteboardType.telegram, urlString: AppScheme.telegramImport)
    }
    .runOnQueue(.main)

    AsyncFunction("copyStickersToAppGroup") { (appGroup: String, fileUris: [String]) -> Int in
      let directory = try Self.appGroupStickerDirectory(appGroup)
      var copied = 0
      for uri in fileUris {
        guard let source = URL(string: uri) ?? URL(fileURLWithPath: uri) as URL? else { continue }
        let destination = directory.appendingPathComponent(source.lastPathComponent)
        if FileManager.default.fileExists(atPath: destination.path) {
          try? FileManager.default.removeItem(at: destination)
        }
        do {
          try FileManager.default.copyItem(at: source, to: destination)
          copied += 1
        } catch {
          continue
        }
      }
      return copied
    }

    AsyncFunction("getAppGroupStickerCount") { (appGroup: String) -> Int in
      let directory = try Self.appGroupStickerDirectory(appGroup)
      let contents = try FileManager.default.contentsOfDirectory(atPath: directory.path)
      return contents.filter { $0.hasSuffix(".png") }.count
    }

    AsyncFunction("clearAppGroupStickers") { (appGroup: String) in
      let directory = try Self.appGroupStickerDirectory(appGroup)
      let contents = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      for file in contents {
        try? FileManager.default.removeItem(at: file)
      }
    }
  }

  /// The messengers read the pack from the pasteboard right after they are opened, so
  /// the item must be local-only and short-lived: it contains the user's photos.
  private static func handOff(json: [String: Any], pasteboardType: String, urlString: String) async throws -> Bool {
    guard let url = URL(string: urlString), UIApplication.shared.canOpenURL(url) else {
      throw AppNotInstalledException(urlString)
    }

    let data = try JSONSerialization.data(withJSONObject: json, options: [])
    UIPasteboard.general.setItems(
      [[pasteboardType: data]],
      options: [
        .localOnly: true,
        .expirationDate: Date().addingTimeInterval(60),
      ]
    )

    return await withCheckedContinuation { continuation in
      UIApplication.shared.open(url, options: [:]) { opened in
        continuation.resume(returning: opened)
      }
    }
  }

  private static func appGroupStickerDirectory(_ appGroup: String) throws -> URL {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
      throw AppGroupUnavailableException(appGroup)
    }
    let directory = container.appendingPathComponent("stickers", isDirectory: true)
    if !FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    return directory
  }
}

internal final class InvalidPackException: GenericException<String> {
  override var reason: String {
    "Invalid sticker pack: \(param)"
  }
}

internal final class AppNotInstalledException: GenericException<String> {
  override var reason: String {
    "Target app cannot be opened: \(param)"
  }
}

internal final class AppGroupUnavailableException: GenericException<String> {
  override var reason: String {
    "App Group \(param) is not available. Check the entitlement on both targets."
  }
}
