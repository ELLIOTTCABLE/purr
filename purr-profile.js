module.exports = {
   token: process.env['PURR_DISCORD_TOKEN'],
   access_roles: new Set((process.env['PURR_ACCESS_ROLES'] || '').split(':')),
}
