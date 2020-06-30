module.exports = {
   token: process.env['PURR_DISCORD_TOKEN'],
   access_roles: new Set((process.env['PURR_ACCESS_ROLES'] || '').split(':')),
   redis_url: process.env['PURR_REDIS_URL'] || process.env['REDIS_URL'],
   web_port: process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 8080,
}
