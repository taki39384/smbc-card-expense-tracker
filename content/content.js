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

    console.log('Search query:', searchQuery);

    // Execute search via hash change (doesn't reload page)
    await executeGmailSearch(searchQuery);

    // Wait for search results to load
    await waitForSearchResults();

    // Get all email items from search results
    const emailItems = await getEmailItems();

    console.log('Found emails:', emailItems.length);

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
    const totalEmails = emailItems.length;

    for (let i = 0; i < totalEmails; i++) {
      try {
        // Re-fetch email items after each iteration (DOM may have changed)
        const currentItems = await getEmailItems();
        if (i >= currentItems.length) {
          console.log('Email list changed, stopping at index:', i);
          break;
        }

        console.log(`Processing email ${i + 1}/${totalEmails}`);
        const emailData = await openAndParseEmail(currentItems[i], i);
        if (emailData) {
          details.push(emailData);
          totalAmount += emailData.amount;
          console.log('Extracted:', emailData);
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

  async function executeGmailSearch(query) {
    const encodedQuery = encodeURIComponent(query);

    // Use hash change to navigate (doesn't lose script context)
    const newHash = `#search/${encodedQuery}`;

    console.log('Navigating to:', newHash);

    // Change hash to trigger Gmail's internal navigation
    window.location.hash = newHash;

    // Wait for Gmail to process the hash change
    await sleep(3000);
  }

  async function waitForSearchResults() {
    const maxWait = 15000;
    const interval = 500;
    let waited = 0;

    console.log('Waiting for search results...');

    while (waited < maxWait) {
      // Check if results are loaded
      const emailRows = document.querySelectorAll('tr.zA');

      // Check for "no results" message
      const pageText = document.body.innerText;
      const noResults = pageText.includes('一致するメッセージがありません') ||
                       pageText.includes('No messages matched your search');

      console.log(`Waiting... found ${emailRows.length} rows, noResults: ${noResults}`);

      if (emailRows.length > 0) {
        console.log('Search results loaded');
        await sleep(500);
        return;
      }

      if (noResults) {
        console.log('No results found');
        return;
      }

      await sleep(interval);
      waited += interval;
    }

    console.log('Timeout waiting for search results');
  }

  async function getEmailItems() {
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
      // Look for email body in various Gmail layouts
      const emailBodies = document.querySelectorAll('.a3s.aiL, .ii.gt, .gs .adP');

      for (const body of emailBodies) {
        if (body && body.textContent && body.textContent.length > 100) {
          console.log('Email content loaded');
          return;
        }
      }

      await sleep(interval);
      waited += interval;
    }

    console.log('Timeout waiting for email content');
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
    // Find all potential email body containers
    const emailBodies = document.querySelectorAll('.a3s.aiL, .ii.gt, .gs');

    let text = '';
    for (const body of emailBodies) {
      if (body && body.textContent) {
        text += body.textContent + '\n';
      }
    }

    if (!text) {
      console.log('No email body found');
      return null;
    }

    console.log('Parsing email content, length:', text.length);

    // Extract amount using various patterns
    let amount = 0;

    // Pattern 1: ご利用金額：〇〇,〇〇〇円
    const pattern1 = /ご利用金額[：:]\s*([0-9,]+)\s*円/;
    const match1 = text.match(pattern1);
    if (match1) {
      amount = parseInt(match1[1].replace(/,/g, ''), 10);
      console.log('Amount matched pattern 1:', amount);
    }

    // Pattern 2: ¥〇〇,〇〇〇 or ￥〇〇,〇〇〇
    if (amount === 0) {
      const pattern2 = /[¥￥]\s*([0-9,]+)/;
      const match2 = text.match(pattern2);
      if (match2) {
        amount = parseInt(match2[1].replace(/,/g, ''), 10);
        console.log('Amount matched pattern 2:', amount);
      }
    }

    // Pattern 3: 〇〇,〇〇〇円 (more specific to avoid false positives)
    if (amount === 0) {
      const pattern3 = /([0-9]{1,3}(?:,[0-9]{3})*)\s*円/;
      const match3 = text.match(pattern3);
      if (match3) {
        amount = parseInt(match3[1].replace(/,/g, ''), 10);
        console.log('Amount matched pattern 3:', amount);
      }
    }

    // Extract date - look for usage date patterns
    let date = '';
    // Pattern: ご利用日：2024年1月15日 or similar
    const datePattern1 = /ご利用日[：:]\s*(\d{4})[年\/](\d{1,2})[月\/](\d{1,2})/;
    const dateMatch1 = text.match(datePattern1);
    if (dateMatch1) {
      date = `${dateMatch1[1]}/${dateMatch1[2].padStart(2, '0')}/${dateMatch1[3].padStart(2, '0')}`;
    }

    // Fallback date pattern
    if (!date) {
      const datePattern2 = /(\d{4})[年\/](\d{1,2})[月\/](\d{1,2})/;
      const dateMatch2 = text.match(datePattern2);
      if (dateMatch2) {
        date = `${dateMatch2[1]}/${dateMatch2[2].padStart(2, '0')}/${dateMatch2[3].padStart(2, '0')}`;
      }
    }

    // Extract store name (利用先)
    let store = '';
    const storePattern = /(?:ご利用先|利用先)[：:]\s*(.+?)(?:\n|$|ご利用金額)/;
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
      console.log('No amount found in email');
      return null;
    }

    return {
      date: date || '日付不明',
      store: store || '店舗不明',
      amount
    };
  }

  async function goBackToList() {
    // Method 1: Click back button
    const backButton = document.querySelector('[aria-label="リストに戻る"]') ||
                      document.querySelector('[aria-label="Back to list"]') ||
                      document.querySelector('[data-tooltip="リストに戻る"]') ||
                      document.querySelector('[data-tooltip="Back to list"]');

    if (backButton) {
      console.log('Clicking back button');
      backButton.click();
      await sleep(500);
      return;
    }

    // Method 2: Use keyboard shortcut 'u'
    console.log('Using keyboard shortcut to go back');
    const event = new KeyboardEvent('keydown', {
      key: 'u',
      code: 'KeyU',
      keyCode: 85,
      which: 85,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    await sleep(500);

    // Method 3: Navigate back via hash if still in email view
    if (!document.querySelector('tr.zA')) {
      console.log('Using history.back()');
      window.history.back();
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
