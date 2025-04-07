import axios from "axios";
import fs from "fs";

const apiKey = "sk_02dab316c79ea2965c94c1ccc54cc87702295aa5f008d047"; // Replace this
const voiceId = "9BWtsMINqrJLrRacOk9x"; // Replace this

const payload = {
  text: "Hello from ElevenLabs!",
  voice_settings: {
    stability: 0.5,
    similarity_boost: 0.75
  }
};

try {
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    payload,
    {
      responseType: "stream",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      }
    }
  );

  const writer = fs.createWriteStream("output.mp3");
  response.data.pipe(writer);
  writer.on("finish", () => console.log("✅ Audio file saved as output.mp3"));
  writer.on("error", (err) => console.error("❌ Write error:", err));
} catch (error) {
  console.error("❌ Error:", error.message);
  if (error.response) {
    console.error("Response data:", error.response.data);
  }
}
