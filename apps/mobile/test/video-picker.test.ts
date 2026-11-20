import { getDocumentAsync } from "expo-document-picker";
import { launchImageLibraryAsync } from "expo-image-picker";
import type { ImagePickerAsset } from "expo-image-picker";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickOrderedVideos, pickVideo } from "../src/video-picker";

vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-image-picker", () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
  launchImageLibraryAsync: vi.fn(),
}));

const photos = vi.mocked(launchImageLibraryAsync);
const files = vi.mocked(getDocumentAsync);

function selectPhotoVideo(asset: Pick<ImagePickerAsset, "uri" | "fileName">) {
  photos.mockResolvedValueOnce({ canceled: false, assets: [{ width: 1920, height: 1080, ...asset }] });
}

afterEach(() => vi.resetAllMocks());

describe("pickVideo", () => {
  it("uses the single-video system picker for Photos and keeps the local copy and filename", async () => {
    const uri = "file:///Caches/ImagePicker/video.mov";
    selectPhotoVideo({ uri, fileName: "Trip.MOV" });

    await expect(pickVideo("Photos")).resolves.toEqual({ uri, name: "Trip.MOV", draftFileName: "video.mov" });
    expect(photos).toHaveBeenCalledWith({
      mediaTypes: ["videos"],
      allowsEditing: false,
      allowsMultipleSelection: false,
      preferredAssetRepresentationMode: "current",
    });
    expect(files).not.toHaveBeenCalled();
  });

  it.each([
    ["video.3gpp", null, "Photos video.3gpp", "video.3gpp"],
    ["video.m4v", "  ", "Photos video.m4v", "video.m4v"],
    ["video.mov", "Holiday", "Holiday", "video.mov"],
    ["video.mp4", "Holiday.MOV", "Holiday.MOV", "video.mp4"],
    ["video", "Holiday.m4v", "Holiday.m4v", "Holiday.m4v"],
    ["video", null, "Photos video", "Photos video"],
  ])("preserves the display name and local suffix for %s with name %j", async (path, fileName, name, draftFileName) => {
    const uri = `file:///Caches/ImagePicker/${path}`;
    selectPhotoVideo({ uri, fileName });

    await expect(pickVideo("Photos")).resolves.toEqual({ uri, name, draftFileName });
  });

  it("still selects a cache copy of a video from Files", async () => {
    const asset = { uri: "file:///Caches/DocumentPicker/File%20clip.mp4", name: "File clip.mp4" };
    files.mockResolvedValueOnce({ canceled: false, assets: [{ ...asset, lastModified: 0 }] });

    await expect(pickVideo("Files")).resolves.toEqual({ ...asset, draftFileName: asset.name });
    expect(files).toHaveBeenCalledWith({ type: "video/*", copyToCacheDirectory: true });
    expect(photos).not.toHaveBeenCalled();
  });

  it("returns no selection when either picker is canceled", async () => {
    photos.mockResolvedValueOnce({ canceled: true, assets: null });
    files.mockResolvedValueOnce({ canceled: true, assets: null });

    await expect(pickVideo("Photos")).resolves.toBeNull();
    await expect(pickVideo("Files")).resolves.toBeNull();
  });

  it("reports when a picker succeeds without returning a usable file", async () => {
    photos.mockResolvedValueOnce({ canceled: false, assets: [] });
    files.mockResolvedValueOnce({ canceled: false, assets: [] });

    await expect(pickVideo("Photos")).rejects.toThrow("Photos did not return a video.");
    await expect(pickVideo("Files")).rejects.toThrow("Files did not return a video.");
  });
});

describe("pickOrderedVideos", () => {
  it("limits the numbered video selection to the open slots and preserves tap order", async () => {
    const assets = ["Z.mov", "A.mp4"].map((name) => ({
      uri: `file:///Caches/ImagePicker/${name}`,
      fileName: name,
      width: 1920,
      height: 1080,
    }));
    photos.mockResolvedValueOnce({ canceled: false, assets });

    const picked = await pickOrderedVideos(3);

    expect(photos).toHaveBeenCalledWith({
      mediaTypes: ["videos"],
      allowsEditing: false,
      preferredAssetRepresentationMode: "current",
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: 3,
    });
    expect(picked?.map(({ name }) => name)).toEqual(["Z.mov", "A.mp4"]);
    expect(files).not.toHaveBeenCalled();
  });

  it("returns no selection when canceled", async () => {
    photos.mockResolvedValueOnce({ canceled: true, assets: null });
    await expect(pickOrderedVideos(2)).resolves.toBeNull();
  });
});
