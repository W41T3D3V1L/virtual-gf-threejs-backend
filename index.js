import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import ffmpegPath from 'ffmpeg-static';
import os from 'os';
import path from 'path';


dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.chatanywhere.tech/v1",
});

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "Xb7hH8MSUJpSbSDYk0k2";

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const wavPath = path.join(os.tmpdir(), `message_${message}.wav`);
  const mp3Path = path.join(os.tmpdir(), `message_${message}.mp3`);
  const jsonPath = path.join(os.tmpdir(), `message_${message}.json`);

  await execCommand(`${ffmpegPath} -y -i ${mp3Path} ${wavPath}`);
  await execCommand(`./bin/rhubarb -f json -o ${jsonPath} ${wavPath} -r phonetic`);
};

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    return res.send({
      messages: [], // You can customize this fallback
    });
  }

  if (!elevenLabsApiKey || !openai.apiKey || openai.apiKey === "-") {
    return res.send({
      messages: [], // API key missing fallback
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1000,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: `
            You are a virtual girlfriend.
            You will always reply with a JSON array of messages. With a maximum of 3 messages.
            Each message has a text, facialExpression, and animation property.
            The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
            The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry.
          `,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    let rawContent = completion.choices[0].message.content;

    if (rawContent.startsWith("```json")) {
      rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    let messages = JSON.parse(rawContent);
    if (messages.messages) messages = messages.messages;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const mp3Path = path.join(os.tmpdir(), `message_${i}.mp3`);
      const jsonPath = path.join(os.tmpdir(), `message_${i}.json`);

      await voice.textToSpeech(elevenLabsApiKey, voiceID, mp3Path, message.text);
      await lipSyncMessage(i);
      message.audio = await audioFileToBase64(mp3Path);
      message.lipsync = await readJsonTranscript(jsonPath);
    }

    res.send({ messages });

  } catch (err) {
    console.error("❌ Error:", err.message || err);
    res.status(500).send({ error: "Something went wrong! 😢", detail: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Virtual Girlfriend listening on port ${port}`);
});