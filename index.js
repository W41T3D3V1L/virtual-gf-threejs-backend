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

// 👇️ Dynamic import
const { textToSpeech } = await import("elevenlabs-node");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const port = 3000;
const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "9BWtsMINqrJLrRacOk9x"; // Replace with your preferred voice
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.chatanywhere.tech/v1",
});
console.log("🔐 Loaded ELEVEN_LABS_API_KEY prefix:", process.env.ELEVEN_LABS_API_KEY?.slice(0, 5));
const execCommand = (command) =>
  new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(stderr || error);
      else resolve(stdout);
    });
  });

const waitForFile = async (filePath, retries = 30, delay = 300) => {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.access(filePath);
      console.log(`✅ File found: ${filePath}`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error(`🕵️ Waited but file never appeared: ${filePath}`);
  throw new Error(`File not found: ${filePath}`);
};

const validateElevenLabsKey = async () => {
  const testText = "Hello test";
  const testPath = path.join(os.tmpdir(), "test.mp3");

  try {
    await textToSpeech(elevenLabsApiKey, voiceID, testPath, testText);
    await waitForFile(testPath);
    await fs.unlink(testPath);
    console.log("✅ ElevenLabs API key is valid!");
  } catch (err) {
    console.error("❌ Invalid ElevenLabs API key or voice ID. Please check it.");
    throw new Error("Invalid ElevenLabs API key.");
  }
};

const lipSyncMessage = async (hash, index) => {
  const wavPath = path.join(os.tmpdir(), `message_${hash}_${index}.wav`);
  const mp3Path = path.join(os.tmpdir(), `message_${hash}_${index}.mp3`);
  const jsonPath = path.join(os.tmpdir(), `message_${hash}_${index}.json`);

  await waitForFile(mp3Path);
  await execCommand(`${ffmpegPath} -y -i ${mp3Path} ${wavPath}`);
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

app.get("/", (req, res) => {
  res.send("✅ Virtual Girlfriend Backend Running!");
});

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage || !elevenLabsApiKey || !openai.apiKey) {
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
          content:
            `You are a virtual girlfriend. Always respond with a JSON array of messages. ` +
            `Each message has text, facialExpression (smile, sad, angry, surprised, funnyFace, default), ` +
            `and animation (Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, Angry). Max 3 messages.`,
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

      let success = false;
      for (let attempt = 1; attempt <= 3 && !success; attempt++) {
        try {
          console.log(`🔊 Generating voice for message[${i}] attempt ${attempt}: ${message.text}`);
          await textToSpeech(elevenLabsApiKey, voiceID, mp3Path, message.text);
          await waitForFile(mp3Path);
          success = true;
        } catch (err) {
          console.warn(`⚠️ TTS attempt ${attempt} failed:`, err.message);
          if (attempt === 3) {
            throw new Error("Text-to-speech generation failed after 3 attempts");
          }
        }
      }

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

app.listen(port, async () => {
  console.log(`🚀 Server running on port ${port}`);
  try {
    await validateElevenLabsKey();
  } catch (err) {
    console.error("❌ Startup check failed:", err.message);
    process.exit(1);
  }
});
