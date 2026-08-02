module.exports = {
  test: {
    globals: true,
    // All test files share the one attendance_test Postgres database, so
    // they must not run concurrently — each file truncates it at startup.
    fileParallelism: false,
  },
};
