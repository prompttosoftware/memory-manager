// Simple in-memory state storage (resets on restart)
const state = {
    last_retrieval_raw_count: 50 // Initialize with a default guess
};

function setLastRetrievalCount(count) {
    if (typeof count === 'number' && count >= 0) {
        state.last_retrieval_raw_count = count;
    }
}

function getLastRetrievalCount() {
    return state.last_retrieval_raw_count;
}

module.exports = {
    setLastRetrievalCount,
    getLastRetrievalCount
};
