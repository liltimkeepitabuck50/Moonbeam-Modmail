// index.js
require("dotenv").config();
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  ActivityType,
  ChannelType
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");

// ---------- CONFIG ----------
const PREFIX = "!";
const MOONBEAM_COLOR = 0x0C1B4A;

// ENV CONFIG
const {
  TOKEN,
  SUPPORT_GUILD_ID,
  SUPPORT_CATEGORY_ID,
  STAFF_ROLE_ID
} = process.env;

// ---------- DATA STORAGE ----------
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const snippetsPath = path.join(dataDir, "snippets.json");
const aliasesPath = path.join(dataDir, "aliases.json");
const threadsPath = path.join(dataDir, "threads.json");
const pendingPath = path.join(dataDir, "pending.json");

function load(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let snippets = load(snippetsPath);
let aliases = load(aliasesPath);
let threads = load(threadsPath);
let pending = load(pendingPath);

// ---------- EMBED HELPERS ----------
function timeString() {
  return new Date().toLocaleTimeString();
}

function MoonbeamEmbed(title, description) {
  return {
    embeds: [{
      title,
      description,
      color: MOONBEAM_COLOR,
      footer: { text: `Moonbeam Staff Team | ${timeString()}` }
    }]
  };
}

function MoonbeamError(description) {
  return {
    embeds: [{
      title: "Error",
      description,
      color: MOONBEAM_COLOR,
      footer: { text: `Moonbeam Staff Team | ${timeString()}` }
    }]
  };
}

function MoonbeamStaffEcho(title, fields) {
  return {
    embeds: [{
      title,
      color: MOONBEAM_COLOR,
      fields,
      footer: { text: `Moonbeam Staff Team | ${timeString()}` }
    }]
  };
}

function MoonbeamUserMessage(description) {
  return {
    embeds: [{
      title: "Moonbeam Staff Message",
      description,
      color: MOONBEAM_COLOR,
      footer: { text: `Moonbeam Staff Team | ${timeString()}` }
    }]
  };
}

// ---------- CLIENT ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// ---------- HELPERS ----------
function isStaff(message) {
  return message.member?.roles?.cache?.has(STAFF_ROLE_ID);
}

function setPending(userId, val) {
  if (val) pending[userId] = true;
  else delete pending[userId];
  save(pendingPath, pending);
}

function isPending(userId) {
  return !!pending[userId];
}

function setThread(userId, channelId) {
  threads[userId] = channelId;
  save(threadsPath, threads);
}

function getThreadChannelId(userId) {
  return threads[userId] || null;
}

function getUserIdFromThread(channelId) {
  const entry = Object.entries(threads).find(([, ch]) => ch === channelId);
  return entry ? entry[0] : null;
}

// ---------- READY ----------
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "Moonbeam Tickets", type: ActivityType.Watching }],
    status: "online"
  });
});

// ---------- MESSAGE HANDLER ----------
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // ---------------- DM FLOW (v14 FIXED) ----------------
  if (message.channel.type === ChannelType.DM) {
    const user = message.author;

    // No thread + not pending → ask confirmation
    if (!getThreadChannelId(user.id) && !isPending(user.id)) {
      setPending(user.id, true);
      await message.channel.send(MoonbeamEmbed(
        "Open a Support Thread?",
        "Are you sure you want to open a support thread with Moonbeam Services? Reply with **yes** to continue."
      ));
      return;
    }

    // Pending confirmation
    if (isPending(user.id)) {
      if (message.content.toLowerCase() === "yes") {
        setPending(user.id, false);

        const guild = client.guilds.cache.get(SUPPORT_GUILD_ID);

        const channel = await guild.channels.create({
          name: `ticket-${user.username}`.toLowerCase(),
          parent: SUPPORT_CATEGORY_ID,
          topic: `ModMail thread for ${user.tag} (${user.id})`
        });

        setThread(user.id, channel.id);

        await message.channel.send(MoonbeamEmbed(
          "Support Thread Opened",
          "Your support thread has been opened. A staff member will respond shortly."
        ));

        await channel.send(MoonbeamEmbed(
          "New Support Thread",
          `Thread opened by **${user.tag}** (${user.id}).`
        ));
      } else {
        setPending(user.id, false);
        await message.channel.send(MoonbeamEmbed(
          "Thread Cancelled",
          "Your request to open a support thread has been cancelled."
        ));
      }
      return;
    }

    // Relay DM to staff
    const threadId = getThreadChannelId(user.id);
    if (!threadId) return;

    const thread = client.channels.cache.get(threadId);
    if (!thread) return;

    await thread.send(MoonbeamStaffEcho(
      `New Message from ${user.tag}`,
      [
        { name: "User", value: `${user.tag} (${user.id})` },
        { name: "Message", value: message.content || "*No content*" }
      ]
    ));

    await message.react("🌙");
    await message.react("✅");
    return;
  }

  // ---------------- STAFF SIDE ----------------
  const content = message.content;

  // COMMANDS
  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/\s+/);
    let cmd = args.shift().toLowerCase();

    // Dynamic snippet command
    if (!["snippet", "alias", "reply", "anymousreply", "statusset"].includes(cmd)) {
      if (snippets[cmd]) {
        const userId = getUserIdFromThread(message.channel.id);
        if (!userId) {
          await message.channel.send(MoonbeamError("This command can only be used inside a ModMail thread."));
          return;
        }

        const user = await client.users.fetch(userId);
        const value = snippets[cmd];

        await user.send(MoonbeamUserMessage(value));

        await message.channel.send(MoonbeamStaffEcho(
          "Snippet Sent to User",
          [
            { name: "Snippet Key", value: cmd },
            { name: "Content", value }
          ]
        ));
        return;
      }
    }

    // Alias resolution
    if (aliases[cmd]) cmd = aliases[cmd];

    // ---------------- SNIPPET COMMAND ----------------
    if (cmd === "snippet") {
      if (!isStaff(message)) return message.channel.send(MoonbeamError("You lack permission."));

      const sub = (args.shift() || "").toLowerCase();

      if (sub === "add") {
        const key = (args.shift() || "").toLowerCase();
        const value = args.join(" ");
        if (!key || !value) return message.channel.send(MoonbeamError("Usage: `!snippet add <key> <value>`"));

        snippets[key] = value;
        save(snippetsPath, snippets);

        return message.channel.send(MoonbeamStaffEcho(
          "Snippet Created",
          [
            { name: "Key", value: key },
            { name: "Content", value }
          ]
        ));
      }

      if (sub === "delete") {
        const key = (args.shift() || "").toLowerCase();
        if (!snippets[key]) return message.channel.send(MoonbeamError("Snippet does not exist."));

        delete snippets[key];
        save(snippetsPath, snippets);

        return message.channel.send(MoonbeamStaffEcho(
          "Snippet Deleted",
          [{ name: "Key", value: key }]
        ));
      }

      if (sub === "list") {
        const list = Object.keys(snippets).length
          ? Object.keys(snippets).map(k => `\`${k}\``).join(", ")
          : "No snippets created.";

        return message.channel.send(MoonbeamStaffEcho(
          "Snippets",
          [{ name: "Keys", value: list }]
        ));
      }

      if (sub === "send") {
        const key = (args.shift() || "").toLowerCase();
        const value = snippets[key];
        if (!value) return message.channel.send(MoonbeamError("Snippet does not exist."));

        const userId = getUserIdFromThread(message.channel.id);
        const user = await client.users.fetch(userId);

        await user.send(MoonbeamUserMessage(value));

        return message.channel.send(MoonbeamStaffEcho(
          "Snippet Sent to User",
          [
            { name: "Snippet Key", value: key },
            { name: "Content", value }
          ]
        ));
      }

      return message.channel.send(MoonbeamError("Subcommands: add, delete, list, send"));
    }

    // ---------------- ALIAS COMMAND ----------------
    if (cmd === "alias") {
      if (!isStaff(message)) return message.channel.send(MoonbeamError("You lack permission."));

      const sub = (args.shift() || "").toLowerCase();

      if (sub === "add") {
        const alias = (args.shift() || "").toLowerCase();
        const commandName = (args.shift() || "").toLowerCase();
        if (!alias || !commandName) return message.channel.send(MoonbeamError("Usage: `!alias add <alias> <command>`"));

        aliases[alias] = commandName;
        save(aliasesPath, aliases);

        return message.channel.send(MoonbeamStaffEcho(
          "Alias Created",
          [
            { name: "Alias", value: alias },
            { name: "Command", value: commandName }
          ]
        ));
      }

      if (sub === "remove") {
        const alias = (args.shift() || "").toLowerCase();
        if (!aliases[alias]) return message.channel.send(MoonbeamError("Alias does not exist."));

        delete aliases[alias];
        save(aliasesPath, aliases);

        return message.channel.send(MoonbeamStaffEcho(
          "Alias Removed",
          [{ name: "Alias", value: alias }]
        ));
      }

      if (sub === "list") {
        const list = Object.entries(aliases).length
          ? Object.entries(aliases).map(([a, c]) => `\`${a}\` → \`${c}\``).join("\n")
          : "No aliases set.";

        return message.channel.send(MoonbeamStaffEcho(
          "Aliases",
          [{ name: "Mappings", value: list }]
        ));
      }

      return message.channel.send(MoonbeamError("Subcommands: add, remove, list"));
    }

    // ---------------- REPLY COMMAND ----------------
    if (cmd === "reply") {
      if (!isStaff(message)) return message.channel.send(MoonbeamError("You lack permission."));

      const text = args.join(" ");
      if (!text) return message.channel.send(MoonbeamError("Usage: `!reply <message>`"));

      const userId = getUserIdFromThread(message.channel.id);
      const user = await client.users.fetch(userId);

      await user.send(MoonbeamUserMessage(text));

      return message.channel.send(MoonbeamStaffEcho(
        "Reply Sent to User",
        [{ name: "Message", value: text }]
      ));
    }

    // ---------------- ANONYMOUS REPLY ----------------
    if (cmd === "anymousreply") {
      if (!isStaff(message)) return message.channel.send(MoonbeamError("You lack permission."));

      const text = args.join(" ");
      if (!text) return message.channel.send(MoonbeamError("Usage: `!anymousreply <message>`"));

      const userId = getUserIdFromThread(message.channel.id);
      const user = await client.users.fetch(userId);

      await user.send(MoonbeamUserMessage(text));

      return message.channel.send(MoonbeamStaffEcho(
        "Anonymous Reply Sent",
        [{ name: "Message", value: text }]
      ));
    }

    // ---------------- STATUS SET ----------------
    if (cmd === "statusset") {
      if (!isStaff(message)) return message.channel.send(MoonbeamError("You lack permission."));

      const type = (args.shift() || "").toLowerCase();
      const value = args.join(" ");
      if (!type || !value) return message.channel.send(MoonbeamError("Usage: `!statusset <type> <text>`"));

      let activityType;
      if (type === "playing") activityType = ActivityType.Playing;
      else if (type === "watching") activityType = ActivityType.Watching;
      else if (type === "listening") activityType = ActivityType.Listening;
      else if (type === "competing") activityType = ActivityType.Competing;
      else return message.channel.send(MoonbeamError("Invalid type."));

      client.user.setPresence({
        activities: [{ name: value, type: activityType }],
        status: "online"
      });

      return message.channel.send(MoonbeamStaffEcho(
        "Bot Status Updated",
        [
          { name: "Type", value: type },
          { name: "Status", value }
        ]
      ));
    }

    return;
  }

  // ---------------- NORMAL STAFF MESSAGE RELAY ----------------
  const userId = getUserIdFromThread(message.channel.id);
  if (userId && !message.author.bot) {
    const user = await client.users.fetch(userId);

    await user.send(MoonbeamUserMessage(message.content));

    await message.react("🌙");
    await message.react("✅");
  }
});

// ---------- USER LEAVE HANDLER ----------
client.on("guildMemberRemove", async (member) => {
  const userId = member.user.id;
  const threadId = getThreadChannelId(userId);
  if (!threadId) return;

  const thread = client.channels.cache.get(threadId);
  if (!thread) return;

  const mutual = client.guilds.cache.filter(g => g.members.cache.has(userId));

  if (!mutual.size) {
    await thread.send(MoonbeamEmbed(
      "User Left All Common Servers",
      `This person has left **${member.guild.name}**.\nThey no longer have any common servers with us.`
    ));
  } else {
    const list = mutual.map(g => `- ${g.name}`).join("\n");
    await thread.send(MoonbeamEmbed(
      "User Left a Server",
      `${member.user.tag} has left **${member.guild.name}**.\nThey still share these servers with us:\n${list}`
    ));
  }
});

// ---------- UPTIME SERVER ----------
const app = express();
app.get("/", (req, res) => res.send("Moonbeam ModMail is alive."));
app.listen(process.env.PORT || 3000, () => console.log("Uptime server running."));

// ---------- LOGIN ----------
client.login(TOKEN);
