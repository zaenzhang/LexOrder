// Runtime children inherit the workspace lock on fd 4. Stop serving or
// writing the old workspace if the owner dies, then the kernel drops the lock.
process.once('disconnect', () => process.exit(1));
process.channel.unref();
