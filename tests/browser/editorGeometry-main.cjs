const { app } = require('electron')

// Separate profile and protocol handling keep the browser regression isolated
// from any normal KE instance. No project files or installed app are modified.
if (!process.env.KE_GEOMETRY_PROFILE) throw new Error('Missing test profile')
app.setPath('userData', process.env.KE_GEOMETRY_PROFILE)
app.setAsDefaultProtocolClient = () => false
process.argv = [process.argv[0]]
require('../../electron/main.cjs')
