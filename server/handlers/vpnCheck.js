const axios = require("axios");

module.exports = async (key, db, ip, res) => {
  let ipcache = null;
  const cacheKey = `vpncheckcache-${ip}`;
  const row = await db.heliactyl.findUnique({ where: { key: cacheKey } });
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed.expires && Date.now() > parsed.expires) {
        await db.heliactyl.delete({ where: { key: cacheKey } });
      } else {
        ipcache = parsed.value;
      }
    } catch { /* corrupted cache entry, ignore */ }
  }
  
  if (!ipcache) {
    try {
      const response = await axios.get(`https://api.ipapi.is/?q=${ip}`, {
        timeout: 5000
      });
      
      const data = response.data;
      
      if (data) {
        // Check if VPN, proxy, datacenter, Tor, or abusive IP
        if (data.is_vpn === true || data.is_proxy === true || data.is_datacenter === true || data.is_tor === true || data.is_abuser === true) {
          ipcache = "yes";
        } else {
          ipcache = "no";
        }
      }
    } catch (error) {
      // Silently fail - allow request if check fails
      return false;
    }
  }
  
  // Cache result for 48 hours
  if (ipcache) {
    const cacheData = JSON.stringify({ value: ipcache, expires: Date.now() + 172800000 });
    await db.heliactyl.upsert({
      where: { key: cacheKey },
      update: { value: cacheData },
      create: { key: cacheKey, value: cacheData }
    });
  }
  
  // Block if VPN/proxy detected
  if (ipcache === "yes") {
    return { blocked: true, ip: ip };
  }
  
  return { blocked: false, ip: ip };
};

/**
 * Check VPN and send response directly (legacy mode)
 */
module.exports.checkAndBlock = async (key, db, ip, res) => {
  const result = await module.exports(key, db, ip);
  if (result.blocked) {
    res.send('VPN Detected! Please disable your VPN to continue.');
    return true;
  }
  return false;
};
