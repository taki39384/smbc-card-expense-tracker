// Content script for Gmail DOM manipulation
(function() {
  'use strict';

  // Listen for messages from service worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'aggregate') {
      handleAggregation(request.startDate, request.endDate)
        .then(data => sendResponse({ data }))
        .catch(error => sendResponse({ error: error.message }));
      return true; // Keep the message channel open for async response
    }
  });

  async function handleAggregation(startDate, endDate) {
    // Format dates for Gmail search
    const start = formatDateForSearch(startDate);
    const end = formatDateForSearch(endDate, true);

    // Build search query for SMBC card notifications
    const searchQuery = `from:contact@vpass.ne.jp subject:ご利用のお知らせ after:${start} before:${end}`;

    // Execute search via URL navigation (most reliable method)
    await executeGmailSearchViaURL(searchQuery);

    // Wait for search results to load
    await waitForSearchResults();

    // Get all email items from search results
    const emailItems = await getEmailItems();

    if (emailItems.length === 0) {
      return {
        totalAmount: 0,
        count: 0,
        details: []
      };
    }

    // Process each email to extract amount
    const details = [];
    let totalAmount = 0;

    for (let i = 0; i < emailItems.length; i++) {
      try {
        // Re-fetch email items after each iteration (DOM may have changed)
        const currentItems = await getEmailItems();
        if (i >= currentItems.length) break;

        const emailData = await openAndParseEmail(currentItems[i], i);
        if (emailData) {
          details.push(emailData);
          totalAmount += emailData.amount;
        }
      } catch (e) {
        console.error('Error processing email:', e);
      }
    }

    // Sort by date descending
    details.sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
      totalAmount,
      count: details.length,
      details
    };
  }

  function formatDateForSearch(dateStr, addOneDay = false) {
    const date = new Date(dateStr);
    if (addOneDay) {
      date.setDate(date.getDate() + 1);
    }
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }

  async function executeGmailSearchViaURL(query) {
    // Get current Gmail URL base
    const currentUrl = window.location.href;
    const baseMatch = currentUrl.match(/(https:\/\/mail\.google\.com\/mail\/u\/\d+)/);

    if (!baseMatch) {
      throw new Error('GmailのURLを認識できません。Gmailのメイン画面を開いてください。');
    }

    const baseUrl = baseMatch[1];
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `${baseUrl}/#search/${encodedQuery}`;

    // Navigate to search URL
    window.location.href = searchUrl;

    // Wait for URL to change and page to start loading
    await waitForUrlChange(searchUrl);

    // Additional wait for page content to load
    await sleep(2000);
  }

  async function waitForUrlChange(targetUrl) {
    const maxWait = 5000;
    const interval = 100;
    let waited = 0;

    while (waited < maxWait) {
      if (window.location.href.includes('#search/')) {
        return;
      }
      await sleep(interval);
      waited += interval;
    }
  }

  async function waitForSearchResults() {
    // Wait for search results to load
    const maxWait = 15000;
    const interval = 500;
    let waited = 0;

    while (waited < maxWait) {
      // Check if we're on a search results page
      if (!window.location.href.includes('#search/')) {
        await sleep(interval);
        waited += interval;
        continue;
      }

      // Check if results are loaded (either email rows exist or "no results" message)
      const emailRows = document.querySelectorAll('tr.zA');
      const noResultsElements = document.querySelectorAll('.TC');
      let noResults = false;

      noResultsElements.forEach(el => {
        if (el.textContent.includes('一致するメッセージがありません') ||
            el.textContent.includes('No messages matched')) {
          noResults = true;
        }
      });

      // Also check for the empty state
      const emptyState = document.querySelector('.ae4');
      if (emptyState && emptyState.textContent.includes('一致する')) {
        noResults = true;
      }

      if (emailRows.length > 0 || noResults) {
        // Wait a bit more for full render
        await sleep(500);
        return;
      }

      await sleep(interval);
      waited += interval;
    }

    throw new Error('検索結果の読み込みがタイムアウトしました。');
  }

  async function getEmailItems() {
    // Get all email row elements from the current view
    const rows = document.querySelectorAll('tr.zA');
    return Array.from(rows);
  }

  async function openAndParseEmail(emailRow, index) {
    // Click to open email
    emailRow.click();
    await sleep(1500);

    // Wait for email content to load
    await waitForEmailContent();

    // Parse email content
    const emailData = parseEmailContent();

    // Go back to search results
    await goBackToList();
    await sleep(1000);

    // Wait for list to be visible again
    await waitForListView();

    return emailData;
  }

  async function waitForEmailContent() {
    const maxWait = 10000;
    const interval = 300;
    let waited = 0;

    while (waited < maxWait) {
      const emailBody = document.querySelector('.a3s.aiL') ||
                       document.querySelector('.ii.gt') ||
                       document.querySelector('[data-message-id]');

      if (emailBody && emailBody.textContent.length > 50) {
        return;
      }

      await sleep(interval);
      waited += interval;
    }
  }

  async function waitForListView() {
    const maxWait = 8000;
    const interval = 300;
    let waited = 0;

    while (waited < maxWait) {
      const rows = document.querySelectorAll('tr.zA');
      if (rows.length > 0) {
        return;
      }
      await sleep(interval);
      waited += interval;
    }
  }

  function parseEmailContent() {
    // Find email body
    const emailBody = document.querySelector('.a3s.aiL') ||
                     document.querySelector('.ii.gt') ||
                     document.querySelector('.gs');

    if (!emailBody) {
      return null;
    }

    const text = emailBody.textContent || emailBody.innerText;

    // Extract amount using various patterns
    let amount = 0;

    // Pattern 1: ご利用金額：〇〇,〇〇〇円
    const pattern1 = /ご利用金額[：:]\s*([0-9,]+)\s*円/;
    const match1 = text.match(pattern1);
    if (match1) {
      amount = parseInt(match1[1].replace(/,/g, ''), 10);
    }

    // Pattern 2: ¥〇〇,〇〇〇 or ￥〇〇,〇〇〇
    if (amount === 0) {
      const pattern2 = /[¥￥]\s*([0-9,]+)/;
      const match2 = text.match(pattern2);
      if (match2) {
        amount = parseInt(match2[1].replace(/,/g, ''), 10);
      }
    }

    // Pattern 3: 〇〇,〇〇〇円
    if (amount === 0) {
      const pattern3 = /([0-9,]+)\s*円/;
      const match3 = text.match(pattern3);
      if (match3) {
        amount = parseInt(match3[1].replace(/,/g, ''), 10);
      }
    }

    // Extract date
    let date = '';
    const datePattern = /(\d{4})[年\/](\d{1,2})[月\/](\d{1,2})/;
    const dateMatch = text.match(datePattern);
    if (dateMatch) {
      date = `${dateMatch[1]}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3].padStart(2, '0')}`;
    }

    // Extract store name (利用先)
    let store = '';
    const storePattern = /(?:ご利用先|利用先)[：:]\s*(.+?)(?:\n|$|ご利用)/;
    const storeMatch = text.match(storePattern);
    if (storeMatch) {
      store = storeMatch[1].trim();
    }

    // Alternative store pattern
    if (!store) {
      const storePattern2 = /(?:店名|加盟店)[：:]\s*(.+?)(?:\n|$)/;
      const storeMatch2 = text.match(storePattern2);
      if (storeMatch2) {
        store = storeMatch2[1].trim();
      }
    }

    if (amount === 0) {
      return null;
    }

    return {
      date: date || '日付不明',
      store: store || '店舗不明',
      amount
    };
  }

  async function goBackToList() {
    // Try to find and click back button
    const backButton = document.querySelector('[aria-label="リストに戻る"]') ||
                      document.querySelector('[aria-label="Back to list"]') ||
                      document.querySelector('[data-tooltip="リストに戻る"]') ||
                      document.querySelector('[data-tooltip="Back to list"]') ||
                      document.querySelector('.ak.T-I-J3.J-J5-Ji');

    if (backButton) {
      backButton.click();
      await sleep(500);
      return;
    }

    // Alternative: use browser back or keyboard shortcut
    window.history.back();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
