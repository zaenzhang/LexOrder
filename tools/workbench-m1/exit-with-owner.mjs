// Stop serving or writing the workspace if its owner dies. On Linux the
// child also holds the directory lock on fd 4 until it exits.
process.once('disconnect', () => process.exit(1));
process.on('message', message => {
  if (message === 'lexorder:quit') process.emit('SIGTERM', 'SIGTERM');
});
process.channel.unref();
