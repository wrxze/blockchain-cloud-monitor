'use strict';

const STORAGE_KEY = 'blockchain-cloud-monitor-v1';
const $ = (id) => document.getElementById(id);

let chain = [];

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Web Crypto API недоступен. Откройте сайт через HTTPS или localhost.');
  }
  const data = new TextEncoder().encode(value);
  return bytesToHex(await window.crypto.subtle.digest('SHA-256', data));
}

function canonicalBlock(block) {
  // Хешируем только содержимое блока, исключая поле hash.
  return JSON.stringify({
    index: block.index,
    timestamp: block.timestamp,
    previousHash: block.previousHash,
    transactions: block.transactions
  });
}

async function createBlock(index, previousHash, transaction) {
  const block = {
    index,
    timestamp: new Date().toISOString(),
    previousHash,
    transactions: [transaction]
  };
  block.hash = await sha256(canonicalBlock(block));
  return block;
}

async function createTransaction(sender, recipient, amount, status = 'Pending') {
  const transaction = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sender,
    recipient,
    amount: Number(amount),
    status,
    timestamp: new Date().toISOString()
  };
  transaction.hash = await sha256(JSON.stringify(transaction));
  return transaction;
}

async function addTransaction(sender, recipient, amount) {
  const transaction = await createTransaction(sender, recipient, amount);
  const previousHash = chain.length ? chain[chain.length - 1].hash : 'GENESIS';
  const block = await createBlock(chain.length, previousHash, transaction);
  chain.push(block);
  saveChain();
  render();
  window.setTimeout(() => confirmTransaction(transaction.id), 4000);
}

async function confirmTransaction(id) {
  const block = chain.find(item => item.transactions.some(tx => tx.id === id));
  if (!block) return;
  const tx = block.transactions.find(item => item.id === id);
  if (tx.status !== 'Pending') return;
  tx.status = 'Confirmed';
  tx.hash = await sha256(JSON.stringify({
    id: tx.id, sender: tx.sender, recipient: tx.recipient,
    amount: tx.amount, status: tx.status, timestamp: tx.timestamp
  }));
  // Пересчитываем хеш изменённого блока и все последующие ссылки.
  await rebuildHashesFrom(block.index);
  saveChain();
  render();
}

async function rebuildHashesFrom(startIndex) {
  for (let i = startIndex; i < chain.length; i++) {
    chain[i].previousHash = i === 0 ? 'GENESIS' : chain[i - 1].hash;
    chain[i].hash = await sha256(canonicalBlock(chain[i]));
  }
}

async function verifyChain() {
  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    if (block.index !== i) return { valid: false, message: `Неверный индекс блока ${i}.` };
    const expectedPrevious = i === 0 ? 'GENESIS' : chain[i - 1].hash;
    if (block.previousHash !== expectedPrevious) {
      return { valid: false, message: `Нарушена связь с предыдущим блоком №${i}.` };
    }
    const calculatedHash = await sha256(canonicalBlock(block));
    if (calculatedHash !== block.hash) {
      return { valid: false, message: `Обнаружено изменение данных в блоке №${i}.` };
    }
    for (const tx of block.transactions) {
      const expectedTxHash = await sha256(JSON.stringify({
        id: tx.id, sender: tx.sender, recipient: tx.recipient,
        amount: tx.amount, status: tx.status, timestamp: tx.timestamp
      }));
      if (expectedTxHash !== tx.hash) {
        return { valid: false, message: `Нарушена целостность транзакции ${tx.id}.` };
      }
    }
  }
  return { valid: true, message: 'Все хеши совпадают. Цепочка целостна.' };
}

function saveChain() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chain));
}

function loadChain() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (error) {
    console.warn('Не удалось прочитать сохранённые данные:', error);
  }
  return null;
}

function shortHash(hash) {
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

function render() {
  const rows = $('transactionRows');
  rows.replaceChildren();
  const transactions = chain.flatMap(block => block.transactions.map(tx => ({ ...tx, block: block.index })));
  $('emptyState').hidden = transactions.length !== 0;

  transactions.slice().reverse().forEach(tx => {
    const tr = document.createElement('tr');
    const values = [
      `#${tx.block}`, tx.sender, tx.recipient,
      `${tx.amount.toFixed(2)}`, shortHash(tx.hash)
    ];
    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (index === 4) td.className = 'hash';
      tr.appendChild(td);
    });
    const statusCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `status status-${tx.status.toLowerCase()}`;
    badge.textContent = tx.status;
    statusCell.appendChild(badge);
    tr.appendChild(statusCell);
    rows.appendChild(tr);
  });

  $('totalCount').textContent = transactions.length;
  $('confirmedCount').textContent = transactions.filter(tx => tx.status === 'Confirmed').length;
  $('pendingCount').textContent = transactions.filter(tx => tx.status === 'Pending').length;
  $('blockCount').textContent = chain.length;
  $('latestHash').textContent = chain.length ? chain[chain.length - 1].hash : '—';
  $('previousHash').textContent = chain.length > 1 ? chain[chain.length - 2].hash : 'GENESIS';
  $('lastUpdated').textContent = `Обновлено: ${new Date().toLocaleTimeString('ru-RU')}`;
}

function showVerification(result) {
  const badge = $('chainStatus');
  badge.textContent = result.valid ? 'Цепочка целостна' : 'Нарушение обнаружено';
  badge.className = `status-badge ${result.valid ? 'status-valid' : 'status-invalid'}`;
  $('integrityMessage').textContent = result.message;
}

async function seedDemoData() {
  const examples = [
    ['Wallet-A', 'Wallet-B', 125.50],
    ['Wallet-C', 'Wallet-D', 42.00],
    ['Wallet-E', 'Wallet-A', 780.25],
    ['Wallet-B', 'Wallet-F', 19.99],
    ['Wallet-D', 'Wallet-C', 310.00]
  ];
  chain = [];
  for (const [sender, recipient, amount] of examples) {
    const tx = await createTransaction(sender, recipient, amount, 'Confirmed');
    const previousHash = chain.length ? chain[chain.length - 1].hash : 'GENESIS';
    chain.push(await createBlock(chain.length, previousHash, tx));
  }
  saveChain();
}

$('transactionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const sender = $('sender').value.trim();
  const recipient = $('recipient').value.trim();
  const amount = Number($('amount').value);
  if (!sender || !recipient || sender === recipient || !Number.isFinite(amount) || amount <= 0) {
    alert('Проверьте данные: отправитель и получатель должны отличаться, сумма должна быть больше нуля.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Создание…';
  try {
    await addTransaction(sender, recipient, amount);
    $('transactionForm').reset();
    showVerification(await verifyChain());
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Добавить транзакцию';
  }
});

$('verifyBtn').addEventListener('click', async () => {
  try { showVerification(await verifyChain()); }
  catch (error) { showVerification({ valid: false, message: error.message }); }
});

$('tamperBtn').addEventListener('click', () => {
  if (!chain.length || !chain[0].transactions.length) return;
  chain[0].transactions[0].amount += 1;
  // Намеренно не пересчитываем хеш: это демонстрация обнаружения подмены.
  saveChain();
  render();
  showVerification({ valid: false, message: 'Данные изменены вручную. Нажмите «Проверить цепочку» для повторного теста.' });
});

(async function init() {
  try {
    chain = loadChain() || [];
    if (!chain.length) await seedDemoData();
    render();
    showVerification(await verifyChain());
  } catch (error) {
    showVerification({ valid: false, message: error.message });
  }
})();
