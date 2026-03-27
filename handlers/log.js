const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const axios = require('axios');

/**
 * Log an action to a Discord webhook.
 * @param {string} action 
 * @param {string} message 
 */
module.exports = (action, message) => {
    if (!settings.logging.status) return
    if (!settings.logging.actions.user[action] && !settings.logging.actions.admin[action]) return

    axios.post(settings.logging.webhook, {
        embeds: [
            {
                color: hexToDecimal('#FFFFFF'),
                title: `Event: \`${action}\``,
                description: message,
                author: {
                    name: 'Heliactyl Logging'
                },
                thumbnail: {
                    url: settings.website.logo
                }
            }
        ]
    }).catch(() => { })
}

function hexToDecimal(hex) {
    return parseInt(hex.replace("#", ""), 16)
}