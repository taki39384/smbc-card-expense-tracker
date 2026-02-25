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

    // Verify tab exists and is Gmail
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || !tab.url.includes('mail.google.com')) {
      sendResponse({ error: 'Gmailタブが見つかりません。Gmailを開いてから再試行してください。' });
      return;
    }

    // Send message to content script with retry logic
    let response = null;
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await chrome.tabs.sendMessage(tabId, {
          action: 'aggregate',
          startDate: startDate,
          endDate: endDate
        });
        break; // Success, exit retry loop
      } catch (e) {
        lastError = e;
        console.log(`Message send attempt ${attempt + 1} failed:`, e.message);

        // On first failure, try to inject content script
        if (attempt === 0) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['content/content.js']
            });
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (injectError) {
            console.log('Content script injection skipped:', injectError.message);
          }
        } else if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    if (response) {
      sendResponse(response);
    } else {
      const errorMsg = lastError?.message || 'コンテンツスクリプトとの通信に失敗しました';
      // Provide helpful error message
      if (errorMsg.includes('Receiving end does not exist')) {
        sendResponse({ error: 'Gmailページを再読み込みしてから、もう一度お試しください。' });
      } else {
        sendResponse({ error: `処理中にエラーが発生しました: ${errorMsg}` });
      }
    }
  } catch (error) {
    console.error('Service worker error:', error);
    sendResponse({ error: `処理中にエラーが発生しました: ${error.message}` });
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('三井住友カード利用通知集計拡張機能がインストールされました');
});
