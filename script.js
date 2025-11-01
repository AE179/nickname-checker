const nickInput = document.getElementById('nickInput');
const checkButton = document.getElementById('checkButton');
const clearButton = document.getElementById('clearButton');
const resultsContainer = document.getElementById('resultsContainer');
const totalCount = document.getElementById('totalCount');
const availableCount = document.getElementById('availableCount');
const unavailableCount = document.getElementById('unavailableCount');
const checkingCount = document.getElementById('checkingCount');
const availableListSection = document.getElementById('availableListSection');
const availableListContainer = document.getElementById('availableListContainer');

let checking = false;
let results = new Map();

checkButton.addEventListener('click', () => {
    if (checking) return;
    startChecking();
});

clearButton.addEventListener('click', () => {
    nickInput.value = '';
    resultsContainer.innerHTML = '';
    availableListSection.style.display = 'none';
    availableListContainer.innerHTML = '';
    updateStats();
});

async function startChecking() {
    // Pega todas as linhas, remove espaços e filtra apenas as que têm conteúdo real
    const nicks = nickInput.value
        .split('\n')
        .map(nick => nick.trim())
        .filter(nick => nick.length > 0); // Remove linhas vazias completamente

    if (nicks.length === 0) {
        alert('Por favor, insira pelo menos um nick para verificar.');
        return;
    }

    checking = true;
    checkButton.disabled = true;
    checkButton.textContent = 'Verificando...';
    resultsContainer.innerHTML = '';
    results.clear();
    availableListSection.style.display = 'none';
    availableListContainer.innerHTML = '';

    // Adiciona todos os nicks à lista com status "checking"
    nicks.forEach(nick => {
        results.set(nick.toLowerCase(), { nick, status: 'checking' });
        addResultToDOM(nick, 'checking');
    });

    updateStats();

    // Verifica cada nick
    for (const nick of nicks) {
        if (!checking) break; // Permite cancelar se necessário
        
        try {
            const isAvailable = await checkNickAvailability(nick);
            const status = isAvailable ? 'available' : 'unavailable';
            results.set(nick.toLowerCase(), { nick, status });
            updateResultInDOM(nick, status);
        } catch (error) {
            console.error(`Erro ao verificar ${nick}:`, error);
            const errorMessage = error.message || 'Erro desconhecido';
            results.set(nick.toLowerCase(), { nick, status: 'error', errorMessage });
            updateResultInDOM(nick, 'error', errorMessage);
        }
        
        updateStats();
        
        // Delay maior para evitar rate limiting (403/429)
        await sleep(500);
    }

    checking = false;
    checkButton.disabled = false;
    checkButton.textContent = 'Verificar Nicks';
    updateStats();
    
    // Mostra lista de nicks disponíveis ao final
    showAvailableNicks();
}

async function checkNickAvailability(nick) {
    // URL da API da Mojang
    const apiUrl = `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`;
    
    // Lista de proxies CORS como fallback (tenta sem proxy primeiro)
    const corsProxies = [
        apiUrl, // Tenta sem proxy primeiro
        `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`,
        `https://cors-anywhere.herokuapp.com/${apiUrl}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`
    ];
    
    let lastError = null;
    
    // Tenta cada proxy até um funcionar
    for (let i = 0; i < corsProxies.length; i++) {
        const url = corsProxies[i];
        const isProxy = i > 0; // Primeiro item é a URL direta
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });

            // API da Mojang:
            // - 200 OK + JSON: nick existe (não disponível)
            // - 204 No Content: nick não existe (disponível)  
            // - 404 Not Found: nick não existe (disponível)
            // - Outros erros: tentar próximo proxy
            
            let status = response.status;
            
            if (status === 200) {
                // Para qualquer resposta 200, precisa verificar o conteúdo
                const text = await response.text();
                
                if (text.trim() === '' || text === 'null' || text === 'Not Found' || text.toLowerCase() === 'not found') {
                    // Resposta vazia = nick disponível
                    return true;
                }
                
                try {
                    const data = JSON.parse(text);
                    // Se tem dados JSON válidos com id ou name, nick não está disponível
                    if (data && (data.id || data.name)) {
                        return false; // Não disponível
                    }
                    // JSON válido mas sem id/name = disponível
                    return true;
                } catch (e) {
                    // Se não conseguir parsear JSON e não está vazio, provavelmente não disponível
                    // Mas por segurança, considera disponível se for resposta de proxy
                    if (isProxy) {
                        return true;
                    }
                    return false;
                }
            } else if (status === 204 || status === 404) {
                // Nick não existe = disponível
                return true;
            } else if (status === 403 || status === 429) {
                // 403 Forbidden ou 429 Too Many Requests - tenta próximo proxy
                lastError = new Error(`Status HTTP ${status}: ${response.statusText}`);
                continue;
            } else {
                // Status code inesperado, continua para próximo proxy
                lastError = new Error(`Status HTTP ${status}: ${response.statusText}`);
                continue;
            }
        } catch (error) {
            // Erro de rede/CORS - tenta próximo proxy
            lastError = error;
            continue;
        }
    }
    
    // Se todos os proxies falharam, lança o último erro
    if (lastError) {
        if (lastError.name === 'TypeError' || 
            lastError.message.includes('fetch') || 
            lastError.message.includes('Failed to fetch') ||
            lastError.message.includes('CORS')) {
            throw new Error(`Erro de conexão. Todos os proxies CORS falharam. Verifique sua internet.`);
        }
        throw lastError;
    }
    
    throw new Error('Não foi possível verificar o nick');
}

function addResultToDOM(nick, status) {
    const resultItem = document.createElement('div');
    resultItem.className = `result-item ${status}`;
    resultItem.id = `result-${nick.toLowerCase()}`;
    
    const statusText = {
        'available': 'Disponível ✓',
        'unavailable': 'Indisponível ✗',
        'checking': 'Verificando...',
        'error': 'Erro'
    };

    resultItem.innerHTML = `
        <span class="result-nick">${escapeHtml(nick)}</span>
        <span class="result-status ${status}">
            ${statusText[status] || status}
            ${status === 'checking' ? '<span class="loading-spinner"></span>' : ''}
        </span>
    `;
    
    resultsContainer.appendChild(resultItem);
}

function updateResultInDOM(nick, status, errorMessage = '') {
    const resultItem = document.getElementById(`result-${nick.toLowerCase()}`);
    if (!resultItem) return;

    resultItem.className = `result-item ${status}`;
    
    const statusText = {
        'available': 'Disponível ✓',
        'unavailable': 'Indisponível ✗',
        'checking': 'Verificando...',
        'error': errorMessage ? `Erro: ${errorMessage}` : 'Erro'
    };

    const statusSpan = resultItem.querySelector('.result-status');
    statusSpan.className = `result-status ${status}`;
    statusSpan.innerHTML = statusText[status] || status;
}

function updateStats() {
    let total = 0;
    let available = 0;
    let unavailable = 0;
    let checking = 0;

    results.forEach(result => {
        total++;
        if (result.status === 'available') available++;
        else if (result.status === 'unavailable') unavailable++;
        else if (result.status === 'checking') checking++;
    });

    totalCount.textContent = total;
    availableCount.textContent = available;
    unavailableCount.textContent = unavailable;
    checkingCount.textContent = checking;
}

function showAvailableNicks() {
    // Coleta todos os nicks disponíveis
    const availableNicks = [];
    results.forEach(result => {
        if (result.status === 'available') {
            availableNicks.push(result.nick);
        }
    });

    // Se não houver nicks disponíveis, não mostra a seção
    if (availableNicks.length === 0) {
        availableListSection.style.display = 'none';
        return;
    }

    // Ordena os nicks alfabeticamente
    availableNicks.sort();

    // Cria a lista de nicks disponíveis
    availableListContainer.innerHTML = '';
    
    if (availableNicks.length === 1) {
        availableListContainer.innerHTML = `<div class="available-nick-item">${escapeHtml(availableNicks[0])}</div>`;
    } else {
        // Mostra como uma lista ou grid
        availableNicks.forEach(nick => {
            const nickItem = document.createElement('div');
            nickItem.className = 'available-nick-item';
            nickItem.textContent = nick;
            availableListContainer.appendChild(nickItem);
        });
    }

    // Mostra a seção
    availableListSection.style.display = 'block';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Permite verificar ao pressionar Ctrl+Enter
nickInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
        if (!checking) {
            startChecking();
        }
    }
});
