import Messages
import UIKit

/// Shows the stickers the user added to Messages from inside the app.
///
/// The app copies 512x512 PNG files into `<app group container>/stickers`, and this
/// extension reads that directory every time it becomes active. Nothing is generated or
/// downloaded here: the extension has no network access and no session, so it works
/// offline and cannot leak anything the user did not explicitly add.
///
/// The `@objc` name matters. The generated Info.plist declares
/// `NSExtensionPrincipalClass = StickerBrowserViewController`, without a module prefix,
/// so the runtime has to be able to find the class under exactly that name.
@objc(StickerBrowserViewController)
final class StickerBrowserViewController: MSStickerBrowserViewController {
  private static let appGroupSuffix = ".stickers"
  private var stickers: [MSSticker] = []

  override func viewDidLoad() {
    super.viewDidLoad()
    stickerBrowserView.backgroundColor = .clear
    reload()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    // Messages keeps the extension alive between presentations, so a sticker added in the
    // app after this controller was first created has to be picked up here.
    reload()
  }

  private func reload() {
    stickers = Self.loadStickers()
    stickerBrowserView.reloadData()
  }

  // MARK: - MSStickerBrowserViewDataSource

  override func numberOfStickers(in stickerBrowserView: MSStickerBrowserView) -> Int {
    stickers.count
  }

  override func stickerBrowserView(
    _ stickerBrowserView: MSStickerBrowserView,
    stickerAt index: Int
  ) -> MSSticker {
    stickers[index]
  }

  // MARK: - Loading

  /// The App Group identifier is derived from the extension's own bundle id, which is the
  /// main app's bundle id plus a suffix. That keeps the value in one place: the Expo config
  /// that generates both targets.
  private static func appGroupIdentifier() -> String? {
    guard let extensionBundleId = Bundle.main.bundleIdentifier else { return nil }
    let hostBundleId = extensionBundleId
      .split(separator: ".")
      .dropLast()
      .joined(separator: ".")
    return "group.\(hostBundleId)\(appGroupSuffix)"
  }

  private static func loadStickers() -> [MSSticker] {
    guard
      let appGroup = appGroupIdentifier(),
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroup
      )
    else {
      return []
    }

    let directory = container.appendingPathComponent("stickers", isDirectory: true)

    guard
      let files = try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.contentModificationDateKey],
        options: [.skipsHiddenFiles]
      )
    else {
      return []
    }

    // Newest first: the sticker the user just made is the one they want to send.
    let sorted = files
      .filter { $0.pathExtension.lowercased() == "png" }
      .sorted { left, right in
        modificationDate(of: left) > modificationDate(of: right)
      }

    return sorted.compactMap { url in
      try? MSSticker(contentsOfFileURL: url, localizedDescription: "Sticker")
    }
  }

  private static func modificationDate(of url: URL) -> Date {
    let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
    return values?.contentModificationDate ?? .distantPast
  }
}
