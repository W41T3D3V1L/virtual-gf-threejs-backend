import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { exec } from "child_process";
import { promises as fs } from "fs";
import ffmpegPath from "ffmpeg-static";
import os from "os";
import path from "path";
import crypto from "crypto";

const { textToSpeech: rawTextToSpeech } = await import("elevenlabs-node");
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

// === OpenAI & ElevenLabs ===
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.chatanywhere.tech/v1",
});
const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "9BWtsMINqrJLrRacOk9x";

// === Helper Functions ===
const execCommand = (command) =>
  new Promise((resolve, reject) => {
    exec(command, (err, stdout, stderr) => {
      if (err) reject(stderr || err);
      else resolve(stdout);
    });
  });

const waitForFile = async (filePath, retries = 30, delay = 300) => {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.access(filePath);
      console.log(`✅ File found: ${filePath}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`File not found: ${filePath}`);
};

const safeTextToSpeech = async (apiKey, voiceId, filePath, text, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await rawTextToSpeech(apiKey, voiceId, filePath, text);
      await waitForFile(filePath); // confirm file is there
      return;
    } catch (err) {
      console.warn(`⚠️ TTS attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) throw new Error("Text-to-speech generation failed after 3 attempts");
      await new Promise((r) => setTimeout(r, 500 * (i + 1))); // backoff
    }
  }
};

const lipSyncMessage = async (hash, index) => {
  const mp3Path = path.join(os.tmpdir(), `message_${hash}_${index}.mp3`);
  const wavPath = path.join(os.tmpdir(), `message_${hash}_${index}.wav`);
  const jsonPath = path.join(os.tmpdir(), `message_${hash}_${index}.json`);

  console.log("🔄 Converting MP3 to WAV...");
  await execCommand(`${ffmpegPath} -y -i ${mp3Path} ${wavPath}`);

  console.log("💬 Running rhubarb for lip sync...");
  await execCommand(`/bin/rhubarb -f json -o ${jsonPath} ${wavPath} -r phonetic`);
};

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

// === API Routes ===
app.get("/", (req, res) => {
  res.send("✅ Virtual Girlfriend Backend Running!");
});

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage || !elevenLabsApiKey || !openai.apiKey || openai.apiKey === "-") {
    return res.send({ messages: [] });
  }

  try {
    console.log("🧠 Sending prompt to OpenAI...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1000,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: `You are a virtual girlfriend. Always respond with a JSON array of messages. Each message has text, facialExpression (smile, sad, angry, surprised, funnyFace, default), and animation (Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, Angry). Max 3 messages.`,
        },
        { role: "user", content: userMessage },
      ],
    });

    let rawContent = completion.choices[0].message.content;
    if (rawContent.startsWith("```json")) {
      rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    let messages = JSON.parse(rawContent);
    if (messages.messages) messages = messages.messages;

    const hash = crypto.createHash("md5").update(userMessage).digest("hex");

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const mp3Path = path.join(os.tmpdir(), `message_${hash}_${i}.mp3`);
      const jsonPath = path.join(os.tmpdir(), `message_${hash}_${i}.json`);

      console.log(`🔊 Generating voice for message[${i}]: ${message.text}`);
      await safeTextToSpeech(elevenLabsApiKey, voiceID, mp3Path, message.text);
      console.log(`✅ Voice ready: ${mp3Path}`);

      await lipSyncMessage(hash, i);
      message.audio = await audioFileToBase64(mp3Path);
      message.lipsync = await readJsonTranscript(jsonPath);
    }

    res.send({ messages });
  } catch (err) {
    console.error("❌ Backend Error:", err.message || err);
    res.status(500).send({ error: "Something went wrong!", detail: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
