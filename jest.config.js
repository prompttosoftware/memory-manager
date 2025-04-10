// jest.config.js
module.exports = {
    testEnvironment: 'node', // Use Node.js environment for testing
    verbose: true,           // Show detailed test output
    clearMocks: true,        // Automatically clear mock calls and instances between every test
    coverageDirectory: "coverage", // Where to output coverage reports
    // setupFilesAfterEnv: ['./jest.setup.js'], // Optional: if you need global setup/teardown
};
