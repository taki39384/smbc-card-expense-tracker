// Service worker for message relay between popup and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'aggregate') {
    handleAggregateRequest(request, sendResponse);
    return true; // Keep the message channel open for async response
  }
});

async function handleAggregateRequest(request, sendResponse) {
  try {
    const { tabId, startDate, endDate } = request;

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content/content.js']
      });
    } catch (e) {
      // Content script may already be injected, ignore error
      console.log('Content script injection:', e.message);
    }

    // Send message to content script
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'aggregate',
      startDate: startDate,
      endDate: endDate
    });

    sendResponse(response);
  } catch (error) {
    console.error('Service worker error:', error);
    sendResponse({ error: `処理中にエラーが発生しました: ${error.message}` });
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('三井住友カード利用通知集計拡張機能がインストールされました');
});
