document.addEventListener('DOMContentLoaded', () => {
  const startDateInput = document.getElementById('start-date');
  const endDateInput = document.getElementById('end-date');
  const btnThisMonth = document.getElementById('btn-this-month');
  const btnLastMonth = document.getElementById('btn-last-month');
  const btnLast3Months = document.getElementById('btn-last-3-months');
  const btnAggregate = document.getElementById('btn-aggregate');
  const loadingDiv = document.getElementById('loading');
  const errorDiv = document.getElementById('error');
  const resultsDiv = document.getElementById('results');
  const totalAmountSpan = document.getElementById('total-amount');
  const totalCountSpan = document.getElementById('total-count');
  const detailList = document.getElementById('detail-list');

  // Initialize with current month
  setThisMonth();

  // Quick selection buttons
  btnThisMonth.addEventListener('click', () => {
    setThisMonth();
    setActiveButton(btnThisMonth);
  });

  btnLastMonth.addEventListener('click', () => {
    setLastMonth();
    setActiveButton(btnLastMonth);
  });

  btnLast3Months.addEventListener('click', () => {
    setLast3Months();
    setActiveButton(btnLast3Months);
  });

  // Date input change clears active button
  startDateInput.addEventListener('change', clearActiveButtons);
  endDateInput.addEventListener('change', clearActiveButtons);

  // Aggregate button
  btnAggregate.addEventListener('click', executeAggregation);

  function setThisMonth() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    startDateInput.value = formatDate(firstDay);
    endDateInput.value = formatDate(lastDay);
  }

  function setLastMonth() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    startDateInput.value = formatDate(firstDay);
    endDateInput.value = formatDate(lastDay);
  }

  function setLast3Months() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    startDateInput.value = formatDate(firstDay);
    endDateInput.value = formatDate(lastDay);
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setActiveButton(btn) {
    clearActiveButtons();
    btn.classList.add('active');
  }

  function clearActiveButtons() {
    btnThisMonth.classList.remove('active');
    btnLastMonth.classList.remove('active');
    btnLast3Months.classList.remove('active');
  }

  function showLoading() {
    loadingDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    resultsDiv.classList.add('hidden');
    btnAggregate.disabled = true;
  }

  function hideLoading() {
    loadingDiv.classList.add('hidden');
    btnAggregate.disabled = false;
  }

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
  }

  function showResults(data) {
    totalAmountSpan.textContent = `¥${data.totalAmount.toLocaleString()}`;
    totalCountSpan.textContent = `${data.count}件`;

    detailList.innerHTML = '';
    data.details.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="date">${item.date}</span>
        <span class="store">${item.store || '不明'}</span>
        <span class="amount">¥${item.amount.toLocaleString()}</span>
      `;
      detailList.appendChild(li);
    });

    resultsDiv.classList.remove('hidden');
  }

  async function executeAggregation() {
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!startDate || !endDate) {
      showError('開始日と終了日を選択してください。');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      showError('開始日は終了日より前に設定してください。');
      return;
    }

    showLoading();

    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('mail.google.com')) {
        hideLoading();
        showError('Gmailを開いてから実行してください。\n(https://mail.google.com)');
        return;
      }

      // Send message to content script via service worker
      const response = await chrome.runtime.sendMessage({
        action: 'aggregate',
        startDate: startDate,
        endDate: endDate,
        tabId: tab.id
      });

      hideLoading();

      if (response.error) {
        showError(response.error);
      } else {
        showResults(response.data);
      }
    } catch (error) {
      hideLoading();
      showError(`エラーが発生しました: ${error.message}`);
    }
  }
});
