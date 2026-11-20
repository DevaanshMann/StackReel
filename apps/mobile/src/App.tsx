import { Text } from "react-native";
import { Screen, textStyles } from "./Screen";

export default function App() {
  return (
    <Screen>
      <Text style={textStyles.body}>
        Video preview and export are available in the StackReel iOS development build.
      </Text>
    </Screen>
  );
}
