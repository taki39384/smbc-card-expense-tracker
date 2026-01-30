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

    // Process each email thread to extract amounts
    const details = [];
    let totalAmount = 0;
    const totalThreads = emailItems.length;

    for (let i = 0; i < totalThreads; i++) {
      try {
        // Re-fetch email items after each iteration (DOM may have changed)
        const currentItems = await getEmailItems();
        if (i >= currentItems.length) {
          console.log('Email list changed, stopping at index:', i);
          break;
        }

        console.log(`Processing thread ${i + 1}/${totalThreads}`);
        const emailDataList = await openAndParseEmail(currentItems[i], i);

        // emailDataList is now an array of emails from the thread
        if (emailDataList && Array.isArray(emailDataList)) {
          for (const emailData of emailDataList) {
            if (emailData) {
              details.push(emailData);
              totalAmount += emailData.amount;
              console.log('Extracted:', emailData);
            }
          }
        } else if (emailDataList) {
          // Fallback for single email
          details.push(emailDataList);
          totalAmount += emailDataList.amount;
          console.log('Extracted:', emailDataList);
        }
      } catch (e) {
        console.error('Error processing thread:', e);
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
    // Click to open email/thread
    emailRow.click();
    await sleep(2000);

    // Wait for email content to load
    await waitForEmailContent();

    // First, expand ALL collapsed messages in the thread
    await forceExpandAllMessages();

    // Then process all visible message bodies
    const results = await extractAllMessageBodies();

    // Go back to search results
    await goBackToList();
    await sleep(1000);

    // Wait for list to be visible again
    await waitForListView();

    return results;
  }

  async function forceExpandAllMessages() {
    console.log('=== Force expanding all messages ===');

    // Keep trying to expand until no more collapsed messages
    let iteration = 0;
    const maxIterations = 20;

    while (iteration < maxIterations) {
      iteration++;
      let expandedAny = false;

      // Method 1: Click on "○件のメッセージ" collapsed indicator
      const collapsedCounters = document.querySelectorAll('.kQ');
      for (const counter of collapsedCounters) {
        if (counter && counter.offsetParent !== null && counter.textContent.match(/\d+/)) {
          console.log(`Iteration ${iteration}: Clicking collapsed counter: ${counter.textContent}`);
          counter.click();
          await sleep(1500);
          expandedAny = true;
        }
      }

      // Method 2: Click on collapsed message rows (they have .kv class)
      const collapsedRows = document.querySelectorAll('.kv');
      for (const row of collapsedRows) {
        if (row && row.offsetParent !== null) {
          // Check if this row's message body is not visible
          const parentGs = row.closest('.gs');
          if (parentGs) {
            const bodyInParent = parentGs.querySelector('.a3s.aiL, .ii.gt');
            if (!bodyInParent || bodyInParent.offsetParent === null || bodyInParent.textContent.length < 50) {
              console.log(`Iteration ${iteration}: Clicking collapsed row`);
              row.click();
              await sleep(1000);
              expandedAny = true;
            }
          }
        }
      }

      // Method 3: Click on message headers that might be collapsed
      const messageHeaders = document.querySelectorAll('.gE.iv.gt, .h7, .iA.g6');
      for (const header of messageHeaders) {
        if (header && header.offsetParent !== null) {
          const parentContainer = header.closest('[data-legacy-message-id], [data-message-id], .gs');
          if (parentContainer) {
            const bodyInContainer = parentContainer.querySelector('.a3s.aiL, .ii.gt');
            if (!bodyInContainer || bodyInContainer.offsetParent === null || bodyInContainer.textContent.length < 50) {
              console.log(`Iteration ${iteration}: Clicking message header`);
              header.click();
              await sleep(1000);
              expandedAny = true;
            }
          }
        }
      }

      // Method 4: Look for any "展開" or "expand" text links
      const allSpans = document.querySelectorAll('span');
      for (const span of allSpans) {
        if (span.offsetParent !== null &&
            (span.textContent.includes('展開') || span.textContent.toLowerCase().includes('expand'))) {
          console.log(`Iteration ${iteration}: Clicking expand link: ${span.textContent}`);
          span.click();
          await sleep(1000);
          expandedAny = true;
        }
      }

      if (!expandedAny) {
        console.log(`No more messages to expand after ${iteration} iterations`);
        break;
      }
    }

    // Final count
    const finalBodies = document.querySelectorAll('.a3s.aiL');
    console.log(`=== Expansion complete. Found ${finalBodies.length} message bodies ===`);
  }

  async function extractAllMessageBodies() {
    const results = [];
    const processedKeys = new Set();

    // Get all message bodies that are currently visible
    const allBodies = document.querySelectorAll('.a3s.aiL');
    console.log(`Extracting from ${allBodies.length} message bodies`);

    for (let i = 0; i < allBodies.length; i++) {
      const body = allBodies[i];

      // Skip if not visible or too short
      if (!body || body.offsetParent === null) {
        console.log(`Body ${i + 1}: Not visible, skipping`);
        continue;
      }

      const text = body.textContent || '';
      if (text.length < 50) {
        console.log(`Body ${i + 1}: Too short (${text.length} chars), skipping`);
        continue;
      }

      console.log(`Body ${i + 1}: Parsing (${text.length} chars)`);

      const emailData = parseEmailBodyElement(body);
      if (emailData) {
        const key = `${emailData.date}-${emailData.amount}-${emailData.store}`;
        if (!processedKeys.has(key)) {
          processedKeys.add(key);
          results.push(emailData);
          console.log(`Body ${i + 1}: Extracted - date: ${emailData.date}, amount: ${emailData.amount}, store: ${emailData.store}`);
        } else {
          console.log(`Body ${i + 1}: Duplicate key ${key}, skipping`);
        }
      } else {
        console.log(`Body ${i + 1}: No data extracted`);
      }
    }

    // Fallback: try .ii.gt selector if no results
    if (results.length === 0) {
      console.log('Trying fallback selector .ii.gt');
      const altBodies = document.querySelectorAll('.ii.gt');
      for (let i = 0; i < altBodies.length; i++) {
        const body = altBodies[i];
        if (body && body.offsetParent !== null && body.textContent.length > 50) {
          const emailData = parseEmailBodyElement(body);
          if (emailData) {
            const key = `${emailData.date}-${emailData.amount}-${emailData.store}`;
            if (!processedKeys.has(key)) {
              processedKeys.add(key);
              results.push(emailData);
            }
          }
        }
      }
    }

    console.log(`=== Total extracted: ${results.length} messages ===`);
    return results;
  }

  function parseCurrentEmailBody() {
    // Find the currently visible email body
    const emailBody = document.querySelector('.a3s.aiL') ||
                     document.querySelector('.ii.gt');

    if (!emailBody) {
      console.log('No email body found');
      return null;
    }

    return parseEmailBodyElement(emailBody);
  }

  function parseEmailBodyElement(element) {
    if (!element) return null;

    const text = element.textContent || element.innerText;
    if (!text || text.length < 50) return null;

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
      const pattern3 = /([0-9]{1,3}(?:,[0-9]{3})*)\s*円/;
      const match3 = text.match(pattern3);
      if (match3) {
        amount = parseInt(match3[1].replace(/,/g, ''), 10);
      }
    }

    if (amount === 0) return null;

    // Extract date
    let date = '';
    const datePattern1 = /ご利用日[：:]\s*(\d{4})[年\/](\d{1,2})[月\/](\d{1,2})/;
    const dateMatch1 = text.match(datePattern1);
    if (dateMatch1) {
      date = `${dateMatch1[1]}/${dateMatch1[2].padStart(2, '0')}/${dateMatch1[3].padStart(2, '0')}`;
    }

    if (!date) {
      const datePattern2 = /(\d{4})[年\/](\d{1,2})[月\/](\d{1,2})/;
      const dateMatch2 = text.match(datePattern2);
      if (dateMatch2) {
        date = `${dateMatch2[1]}/${dateMatch2[2].padStart(2, '0')}/${dateMatch2[3].padStart(2, '0')}`;
      }
    }

    // Extract store name
    let store = '';
    const storePattern = /(?:ご利用先|利用先)[：:]\s*(.+?)(?:\n|$|ご利用金額)/;
    const storeMatch = text.match(storePattern);
    if (storeMatch) {
      store = storeMatch[1].trim();
    }

    if (!store) {
      const storePattern2 = /(?:店名|加盟店)[：:]\s*(.+?)(?:\n|$)/;
      const storeMatch2 = text.match(storePattern2);
      if (storeMatch2) {
        store = storeMatch2[1].trim();
      }
    }

    return {
      date: date || '日付不明',
      store: store || '店舗不明',
      amount
    };
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
