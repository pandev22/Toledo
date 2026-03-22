const axios = require("axios");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");

const pteroApi = axios.create({
  baseURL: settings.pterodactyl.domain,
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": `Bearer ${settings.pterodactyl.key}`
  }
});

module.exports = async (userid, db) => {
  const user = await db.user.findUnique({ where: { id: userid }, select: { pterodactylId: true } });
  const pteroId = user?.pterodactylId;

  if (!pteroId) {
    throw new Error("Pterodactyl account not linked! Please contact an administrator.");
  }

  try {
    const response = await pteroApi.get(`/api/application/users/${pteroId}?include=servers`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error("Pterodactyl account not found!");
    }
    if (error.response?.status === 401) {
      console.error(`[Pterodactyl] 401 Unauthorized - Check API key configuration`);
      throw new Error("Pterodactyl API authentication failed. Please check your API key configuration.");
    }
    throw error;
  }
};
