import { getDocumentAsync } from "expo-document-picker";
import { UIImagePickerPreferredAssetRepresentationMode, launchImageLibraryAsync } from "expo-image-picker";
import type { ImagePickerAsset, ImagePickerOptions } from "expo-image-picker";

export type VideoPickerSource = "Photos" | "Files";

export type PickedVideo = { uri: string; name: string; draftFileName: string };

function describePhotoVideo({ fileName, uri }: ImagePickerAsset): PickedVideo {
  const path = uri?.split(/[?#]/, 1)[0] ?? "";
  const extension = /\.[a-z0-9]{1,10}$/i.exec(path)?.[0];
  const name = fileName?.trim() || `Photos video${extension ?? ""}`;
  // The local file suffix describes the representation returned by the picker.
  return { uri, name, draftFileName: extension ? `video${extension}` : name };
}

const photoVideoOptions = {
  mediaTypes: ["videos"],
  allowsEditing: false,
  preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Current,
} satisfies ImagePickerOptions;

export async function pickOrderedVideos(selectionLimit: number): Promise<PickedVideo[] | null> {
  const result = await launchImageLibraryAsync({
    ...photoVideoOptions,
    allowsMultipleSelection: true,
    orderedSelection: true,
    selectionLimit,
  });
  return result.canceled ? null : result.assets.map(describePhotoVideo);
}

export async function pickVideo(source: VideoPickerSource): Promise<PickedVideo | null> {
  if (source === "Photos") {
    const result = await launchImageLibraryAsync({
      ...photoVideoOptions,
      allowsMultipleSelection: false,
    });
    if (result.canceled) return null;
    const [asset] = result.assets;
    if (!asset?.uri) throw new Error("Photos did not return a video.");
    return describePhotoVideo(asset);
  }

  const result = await getDocumentAsync({ type: "video/*", copyToCacheDirectory: true });
  if (result.canceled) return null;
  const [asset] = result.assets;
  if (!asset?.uri) throw new Error("Files did not return a video.");
  return { uri: asset.uri, name: asset.name, draftFileName: asset.name };
}
