import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import { StatusBar } from "expo-status-bar";
import { COUNSEL_LABEL, NOTICE_BODY } from "./src/notice";
import { startTracking, stopTracking } from "./src/tracking";

export function App() {
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [deviceToken, setDeviceToken] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Tracking stays off until you acknowledge the notice.");

  async function acknowledge() {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/devices/acknowledge`, {
      method: "POST",
      headers: { authorization: `Bearer ${deviceToken.trim()}` },
    });
    if (!response.ok) {
      setMessage("That device token was not accepted. Ask the office for a phone token.");
      return;
    }
    setAcknowledged(true);
    setMessage("Notice acknowledged. You can start tracking during company hours.");
  }

  async function start() {
    try {
      await startTracking(baseUrl.trim(), deviceToken.trim());
      if (Platform.OS === "android") {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, {
          data: "package:com.adelelectric.field",
        }).catch(() => undefined);
      }
      setRunning(true);
      setMessage("Tracking is on for company hours. Significant-change updates and job regions run in the background.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tracking did not start.");
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Text style={styles.kicker}>Adel Field</Text>
      <Text style={styles.title}>Location on company phones</Text>
      <Text style={styles.body}>{NOTICE_BODY}</Text>
      <Text style={styles.counsel}>{COUNSEL_LABEL}</Text>
      <Text style={styles.label}>Desk address</Text>
      <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.label}>Device token</Text>
      <TextInput style={styles.input} value={deviceToken} onChangeText={setDeviceToken} autoCapitalize="none" autoCorrect={false} secureTextEntry />
      <Pressable style={styles.button} onPress={acknowledge} disabled={!deviceToken.trim()}>
        <Text style={styles.buttonText}>I acknowledge this notice</Text>
      </Pressable>
      <Pressable style={[styles.button, !acknowledged && styles.disabled]} onPress={start} disabled={!acknowledged || running}>
        <Text style={styles.buttonText}>{running ? "Tracking on" : "Start tracking"}</Text>
      </Pressable>
      {running ? (
        <Pressable
          style={styles.quiet}
          onPress={async () => {
            await stopTracking();
            setRunning(false);
            setMessage("Tracking stopped on this phone.");
          }}
        >
          <Text style={styles.quietText}>Stop tracking</Text>
        </Pressable>
      ) : null}
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f1e8", padding: 24, paddingTop: 64 },
  kicker: { color: "#1e4c44", fontSize: 13, letterSpacing: 1, textTransform: "uppercase" },
  title: { color: "#1c1915", fontSize: 28, marginTop: 8, marginBottom: 12 },
  body: { color: "#1c1915", fontSize: 16, lineHeight: 22 },
  counsel: { color: "#8a4b2f", fontSize: 14, marginTop: 12, marginBottom: 16 },
  label: { color: "#5c564c", fontSize: 13, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#d9d0c3", backgroundColor: "#fff", borderRadius: 8, padding: 12, marginBottom: 12 },
  button: { backgroundColor: "#1e4c44", borderRadius: 8, padding: 14, marginTop: 8 },
  disabled: { opacity: 0.45 },
  buttonText: { color: "#f6f1e8", textAlign: "center", fontSize: 16 },
  quiet: { padding: 12 },
  quietText: { textAlign: "center", color: "#1e4c44" },
  message: { marginTop: 12, color: "#1c1915", fontSize: 15, lineHeight: 21 },
});
