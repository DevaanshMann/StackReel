import { space } from "@stackreel/ui";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, AppState, Modal, StyleSheet, Text, View } from "react-native";
import { PreviewFrame } from "./ClipPreview";
import { Action, Screen, textStyles } from "./Screen";
import type { MobileTemplate } from "./template-editor";

export function TemplateExample({
  template,
  source,
  onClose,
}: {
  template: MobileTemplate;
  source: number;
  onClose: () => void;
}) {
  const player = useVideoPlayer(source, (video) => {
    video.muted = true;
    video.loop = true;
    video.allowsExternalPlayback = false;
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const [status, setStatus] = useState(player.status);
  const close = useCallback(() => {
    player.pause();
    onClose();
  }, [player, onClose]);

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status }) => setStatus(status));
    setStatus(player.status);
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") close();
    });
    return () => subscription.remove();
  }, [close]);

  const failure = `Couldn’t play the ${template.name} example.`;
  useEffect(() => {
    if (status === "error") AccessibilityInfo.announceForAccessibility(failure);
  }, [status, failure]);

  return (
    <Modal
      presentationStyle="pageSheet"
      onRequestClose={close}
      onShow={() => {
        if (AppState.currentState === "active") player.play();
        else close();
      }}
    >
      <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={close}>
        <Screen title={`${template.name} example`}>
          <View style={styles.controls}>
            <Action label="Close example" testID="template-example-close" onPress={close} />
            {status !== "error" && (
              <Action
                label={isPlaying ? "Pause example" : "Play example"}
                testID="template-example-playback"
                disabled={status !== "readyToPlay"}
                onPress={() => (player.playing ? player.pause() : player.play())}
              />
            )}
          </View>
          {status === "error" ? (
            <Text accessibilityRole="alert" style={textStyles.error}>
              {failure}
            </Text>
          ) : (
            <PreviewFrame canvas={template.canvas}>
              <VideoView
                testID="template-example-video"
                player={player}
                style={StyleSheet.absoluteFill}
                nativeControls={false}
                allowsVideoFrameAnalysis={false}
                contentFit="contain"
                accessibilityElementsHidden
              />
            </PreviewFrame>
          )}
          <Text style={textStyles.muted}>{template.description}</Text>
        </Screen>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
