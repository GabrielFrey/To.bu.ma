import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Linking, Platform } from 'react-native';

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

export type LibraryAccess = 'all' | 'limited' | 'denied';

/** Longest side sent to the server. Bigger inputs cost bandwidth without helping the model. */
const MAX_UPLOAD_EDGE = 1024;

export async function libraryAccess(): Promise<LibraryAccess> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) {
    return current.accessPrivileges === 'limited' ? 'limited' : 'all';
  }
  if (!current.canAskAgain) return 'denied';

  const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!requested.granted) return 'denied';
  return requested.accessPrivileges === 'limited' ? 'limited' : 'all';
}

/**
 * iOS 14+ lets the user grant access to a hand-picked set of photos. That is a perfectly
 * valid answer, so the app works with it and only offers a shortcut to widen the
 * selection instead of nagging for full access.
 */
export async function presentLimitedLibraryPicker(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await MediaLibrary.presentPermissionsPickerAsync(['photo']);
}

export async function openSystemSettings(): Promise<void> {
  await Linking.openSettings();
}

export async function pickFromLibrary(): Promise<PickedPhoto | null> {
  const access = await libraryAccess();
  if (access === 'denied') {
    throw Object.assign(new Error('Photo library permission denied'), {
      code: 'photo_permission',
    });
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // The app has its own crop step, so the system editor would be a second, worse one.
    allowsEditing: false,
    quality: 1,
    exif: false,
  });

  return firstAsset(result);
}

export async function captureFromCamera(): Promise<PickedPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw Object.assign(new Error('Camera permission denied'), { code: 'camera_permission' });
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    exif: false,
  });

  return firstAsset(result);
}

function firstAsset(result: ImagePicker.ImagePickerResult): PickedPhoto | null {
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface TransformInput {
  uri: string;
  /** In image pixels, already clamped to the source bounds by the caller. */
  crop?: CropRect;
  /** Multiples of 90; applied before the crop rectangle is interpreted. */
  rotation?: number;
}

/**
 * Crop and rotate happen on device so the user sees exactly what they send, and the
 * upload stays small. The result is always JPEG: the source photo has no transparency,
 * and the sticker's alpha channel is produced by the model.
 */
export async function transformPhoto({
  uri,
  crop,
  rotation = 0,
}: TransformInput): Promise<PickedPhoto> {
  let context = ImageManipulator.manipulate(uri);

  if (rotation % 360 !== 0) {
    context = context.rotate(rotation % 360);
  }
  if (crop) {
    context = context.crop(crop);
  }

  const rendered = await context.renderAsync();
  const longestEdge = Math.max(rendered.width, rendered.height);

  if (longestEdge > MAX_UPLOAD_EDGE) {
    const scale = MAX_UPLOAD_EDGE / longestEdge;
    const resized = await ImageManipulator.manipulate(rendered)
      .resize({
        width: Math.round(rendered.width * scale),
        height: Math.round(rendered.height * scale),
      })
      .renderAsync();
    const saved = await resized.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  }

  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * Largest centered square that fits the photo. Used as the crop screen's starting point
 * because a square is what the sticker ends up being.
 */
export function centeredSquare(width: number, height: number): CropRect {
  const size = Math.min(width, height);
  return {
    originX: Math.round((width - size) / 2),
    originY: Math.round((height - size) / 2),
    width: size,
    height: size,
  };
}

/** Keeps a drag/zoom gesture inside the image so the native crop never throws. */
export function clampCrop(rect: CropRect, width: number, height: number): CropRect {
  const size = Math.max(1, Math.min(rect.width, rect.height, width, height));
  return {
    width: size,
    height: size,
    originX: Math.round(Math.min(Math.max(0, rect.originX), width - size)),
    originY: Math.round(Math.min(Math.max(0, rect.originY), height - size)),
  };
}
