// Never loaded for mac builds. If a Windows Squirrel build is ever attempted,
// fail loudly rather than half-working.
throw new Error(
  'temp is stubbed out in this project (see package.json overrides); Windows Squirrel builds are unsupported.'
)
