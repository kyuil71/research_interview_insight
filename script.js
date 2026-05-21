// script.js

// --- CONFIG & CONSTANTS ---
// 모델명 고정 (절대 변경 금지)
const MODEL_NAME = "gemini-flash-latest"; 
const SESSION_KEY_API = "research_lab_api_key_v31";
const PROJECTS_STORAGE_KEY = "research_lab_projects_v31"; // 다중 프로젝트 저장을 위한 키 변경
let currentProjectId = null; // 현재 진행 중인 프로젝트 ID

// --- PROMPT TEMPLATES ---
const PROMPTS = {
  GENERATE_PERSONAS: (topic) => `You are a Senior UX/User Researcher. Topic: "${topic}". 
  사용자를 다음 4가지 카테고리로 나누고, 각 카테고리별로 특성에 맞는 구체적인 페르소나를 3명씩(총 12명) 제안해 주세요.
  
  [카테고리 정의]
  1. 일반 사용자 (General User)
  2. 리드 사용자 (Lead User)
  3. 익스트림 사용자 (Extreme User)
  4. 디자이어 드리븐 사용자 (Desire-Driven User)

  [STRICT RULE]
  - 각 페르소나의 이름은 반드시 "김민준", "이서윤" 같은 한국식 가상의 이름을 사용하여 작성해 주세요. (예: 콘텐츠 유목민: 30대 김민준)
  - "description"은 2줄 이상의 상세한 특성 정보를 포함해 주세요.
  - "needs"는 2줄 이상의 다양하고 구체적인 니즈를 포함해 주세요.
  - 모든 문장은 전문적이고 명확한 존댓말을 사용해 주세요.
  
  [STRICT FORMATTING RULE] Return exactly in this JSON structure:
  {
    "categories": [
      {
        "categoryName": "일반 사용자 (General User)",
        "categoryDesc": "가장 평균적인 사용자입니다. 현재 시장의 '보편적인 기준'을 이해하는 데 중요합니다.",
        "personas": [
          {
            "id": "uuid (unique string)",
            "name": "[수식어]: [직업/연령] [가상 이름]",
            "description": "[상세 설명]",
            "needs": "[구체적인 니즈 및 문제점]"
          }
        ]
      }
    ]
  }`,

  GENERATE_SURVEYS: (topic, persona) => `You are an Expert UX Interviewer. Topic: "${topic}". Persona: "${persona.name}".
  Suggest exactly 15 in-depth interview questions organized into 3 categories (5 per category). 
  [STYLE] Write in clear, straightforward, and conversational Korean. 모든 문장은 존댓말을 사용해 주세요.
  Return JSON: { "surveys": [{ "id": "uuid", "title": "Category Title", "questions": ["Question 1", "Question 2", "..."] }] }.`,

  GENERATE_INTERVIEW: (topic, persona, questions) => `You are a Virtual User named ${persona.name}. Topic: "${topic}". 
  Context: ${persona.description}. Needs: ${persona.needs}.
  Answer ALL the following questions realistically as this persona:
  ${questions.map((q, i) => `${i+1}. ${q}`).join("\n")}
  [RULE] 각 질문에 대한 답변은 5문장 정도로 상세하게 작성해 주세요. 페르소나의 성격이 드러나는 구체적인 에피소드를 반드시 포함하세요. Markdown bold(**) 사용 금지. 모든 문장은 존댓말을 사용해 주세요.
  [FORMAT] For "keyInsights", use 1) 2) 3) format.
  Return JSON: { "summary": "Full session summary", "qaPairs": [{ "q": "Question Text", "a": "Answer Text" }], "keyInsights": "1) ... \\n 2) ..." }.`,

  GENERATE_FOLLOW_UP: (topic, persona, question) => `You are ${persona.name}. Topic: "${topic}".
  Answer the follow-up question: "${question}" in your persona's tone. 
  [RULE] Easy Korean. No markdown bold (**). 모든 문장은 존댓말을 사용해 주세요.
  Return JSON: { "q": "${question}", "a": "Answer" }.`,

  GENERATE_INFERENCES: (topic, persona, qaText, userInsight) => `You are a Senior UX Strategist. Topic: "${topic}". Persona: "${persona.name}".
  [선택된 주요 대화 종합]
  ${qaText}
  [사용자 직접 작성 인사이트]
  ${userInsight || "작성된 내용 없음"}

  위 인터뷰 내용 전체와 사용자 인사이트를 파편적으로 보지 않고 종합적으로 분석하여, 사용자에게 가장 중요한 핵심 가치를 도출하는 "추론(Inference)" 3가지를 작성해 주세요. (개별 대화에 대한 1:1 답변이 아닌 융합적이고 종합적인 추론이어야 합니다.)

  [분석 및 도출 방식 가이드]
  아래의 논리적 흐름 중 맥락에 가장 적합한 방식을 적용하여 추론의 내용(description)을 작성해 주세요.
  1. "인터뷰를 통해 알게 된 ~~~ 내용들로 인해 ~~~것이 중요한 가치라고 유추합니다."
  2. "인터뷰를 통해 알게 된 ~~~ 내용들로 인해 ~~~것이 미래에 중요한 가치가 될 것이라고 유추합니다."
  3. "인터뷰를 통해 알게 된 ~~~ 내용들로 인해 ~~~것들의 조합이 중요한 가치가 될 것이라고 유추합니다."

  [STRICT RULE]
  - 각 추론의 설명(description)은 위 분석 방식을 바탕으로 반드시 3줄 이상의 분량으로 상세하게 작성해 주세요.
  - 모든 문장은 전문적이고 명확한 한국어 존댓말을 사용해 주세요.
  Return JSON: { "inferences": [{ "id": "uuid", "title": "추론 제목 (핵심 가치 키워드)", "description": "3줄 이상의 종합적이고 상세한 설명..." }] }`,

  GENERATE_CONCEPTS: (topic, persona, qaText, userInsight, inference, perspective) => `You are a Senior UX Strategist. Topic: "${topic}". Persona: "${persona.name}".
  [선택된 주요 대화 종합]
  ${qaText}
  [사용자 분석 인사이트]
  ${userInsight || "작성된 내용 없음"}
  [선택된 핵심 가치 추론]
  ${inference.title}: ${inference.description}

  위 내용과 선택된 "핵심 가치 추론"을 중심 기반으로 삼아, "${perspective}" 관점에서 완전히 새롭고 창의적인 디자인 컨셉(가설) 3가지를 제안해 주세요. 단순한 문제 해결을 넘어, 추론된 중요한 가치들을 중심으로 새로운 창의적 컨셉이 될 수 있는 '가설'들이 제안되어야 합니다.

  [STRICT RULE]
  - 각 컨셉에는 반드시 도출된 추론에 기반한 "핵심 가치(coreValue)" 항목이 포함되어야 하며, 2줄 이상의 상세한 문장으로 설명해 주세요.
  - 각 컨셉의 설명(description)은 창의적인 가설과 구체적인 아이디어를 담아 반드시 4줄 이상의 분량으로 매우 상세하고 풍부하게 작성해 주세요.
  - 모든 문장은 전문적이고 명확한 한국어 존댓말을 사용해 주세요.
  Return JSON: { "concepts": [{ "id": "uuid", "title": "창의적 컨셉(가설) 제목", "coreValue": "2줄 이상의 핵심 가치 설명", "description": "4줄 이상의 매우 상세한 창의적 컨셉/가설 설명..." }] }`,

  GENERATE_SCENARIO: (topic, persona, concept) => `You are a Senior UX Designer. Topic: "${topic}". Persona: "${persona.name}".
  [선택된 디자인 컨셉]
  ${concept.title}: ${concept.description}

  위 컨셉을 바탕으로, 해당 페르소나가 일상에서 이 제품/서비스를 사용하는 구체적인 "컨셉 시나리오(User Journey)"를 작성해 주세요.
  [STYLE] 생동감 있고 전문적인 한국어 존댓말을 사용해 주세요. Markdown bold(**) 사용 금지.
  Return JSON: { "scenario": "Detailed scenario text..." }`
};

// --- GLOBAL STATE ---
let state = {
  apiKey: sessionStorage.getItem(SESSION_KEY_API) || "", 
  step: -1, 
  maxStepReached: -1, 
  researchTopic: "",
  aiCategories: [], 
  manualPersonas: [], 
  selectedPersonaId: null,
  aiSurveys: [], 
  manualSurveys: [], 
  selectedQuestionIds: [], 
  history: [], 
  isAnalyzing: false, 
  errorMsg: null,
  selectedQaIndices: [],
  userInsight: "",
  currentInferences: [], 
  selectedInferenceId: null, 
  currentConcepts: [],
  currentPerspective: "종합적 관점",
  selectedConceptId: null,
  currentScenario: ""
};

window.state = state;

function getAllAIPersonas() {
  if (!state.aiCategories) return [];
  return state.aiCategories.flatMap(c => c.personas || []);
}

function getAllPersonas() {
  return [...getAllAIPersonas(), ...state.manualPersonas];
}

// --- STATE MANAGEMENT ---
function setState(newState) {
  const prevStep = state.step;
  if (newState.step !== undefined) state.maxStepReached = Math.max(state.maxStepReached, newState.step);
  state = { ...state, ...newState }; 
  window.state = state;
  render(); 
  if (newState.step !== undefined && newState.step !== prevStep) window.scrollTo({top: 0, behavior: 'smooth'});
}
window.setState = setState;

// --- API CALL ---
async function callGemini(systemPrompt, userPrompt) {
  setState({ isAnalyzing: true, errorMsg: null });
  const apiKey = state.apiKey || "";
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { 
            responseMimeType: "application/json",
            temperature: 0.2 
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        setState({ isAnalyzing: false });
        return JSON.parse(text);
      }

      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Status ${response.status}`);
      }
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'API Error');

    } catch (e) {
      console.error("API Error:", e);
      retries++;
      if (retries === maxRetries) {
        setState({ isAnalyzing: false, errorMsg: "AI 분석 중 문제가 발생했습니다." });
        showToast("오류가 발생했습니다. API 키가 유효한지 확인 후 다시 시도해 주세요.");
        return null;
      }
      const delay = Math.pow(2, retries) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// --- ACTIONS ---
const Actions = {
  async validateKey() {
    const input = document.getElementById('api-input');
    let keyToUse = input?.value || state.apiKey;
    if (!keyToUse) { showToast("API 키를 입력해 주세요."); return; }
    
    setState({ apiKey: keyToUse, isAnalyzing: true });
    
    const test = await callGemini("Return JSON: {\"status\":\"OK\"}", "Test Connection");
    if (test && test.status === "OK" || test) {
      sessionStorage.setItem(SESSION_KEY_API, keyToUse);
      setState({ step: 0 });
    } else {
      sessionStorage.removeItem(SESSION_KEY_API);
      setState({ apiKey: "", errorMsg: "유효하지 않은 API 키입니다." });
    }
  },

  loadFromLocal() {
    let projects = {};
    try {
      projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)) || {};
    } catch(e) {}
    
    const keys = Object.keys(projects).sort((a,b) => projects[b].updatedAt - projects[a].updatedAt);
    if (keys.length === 0) {
      showToast("저장된 프로젝트가 없습니다.");
      return false;
    }
    
    showProjectSelectionModal(projects, keys);
    return true;
  },

  startNewProject() {
    const currentApiKey = state.apiKey;
    const initialState = {
      step: 1, maxStepReached: -1, researchTopic: "", aiCategories: [], manualPersonas: [], 
      selectedPersonaId: null, aiSurveys: [], manualSurveys: [], selectedQuestionIds: [], 
      history: [], isAnalyzing: false, errorMsg: null,
      selectedQaIndices: [], userInsight: "", currentInferences: [], selectedInferenceId: null, currentConcepts: [], currentPerspective: "종합적 관점", selectedConceptId: null, currentScenario: ""
    };
    currentProjectId = null; 
    setState({ ...initialState, apiKey: currentApiKey });
  },

  async generatePersonas(instruction = "") {
    const userPrompt = instruction ? `Topic: ${state.researchTopic}. 추가 지시사항: ${instruction}` : state.researchTopic;
    const res = await callGemini(PROMPTS.GENERATE_PERSONAS(state.researchTopic), userPrompt);
    if (res && res.categories) setState({ aiCategories: res.categories, step: 2 });
  },

  addManualPersona() {
    const nameInput = document.getElementById('manual-p-name');
    const descInput = document.getElementById('manual-p-desc');
    const name = nameInput?.value.trim();
    const desc = descInput?.value.trim();
    if (!name) { showToast("이름을 입력해주세요."); return; }
    const newPersona = { id: 'm' + Date.now(), name: name, description: desc || "", needs: desc || "" };
    setState({ manualPersonas: [...state.manualPersonas, newPersona] });
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    showToast("추가되었습니다.");
  },

  addManualQuestions() {
    const input = document.getElementById('manual-q-input');
    const v = input?.value;
    if (v) {
      const list = v.split('\n').map(x => x.trim()).filter(x => x);
      const nid = 'm' + Date.now();
      const newSelected = [...state.selectedQuestionIds, ...list.map((_, i) => nid + '-' + i)];
      setState({
        manualSurveys: [...state.manualSurveys, { id: nid, title: '사용자 추가 질문', questions: list }],
        selectedQuestionIds: newSelected
      });
      if (input) input.value = '';
      showToast("질문이 추가되었습니다.");
    }
  },

  async generateSurveys() {
    const persona = getAllPersonas().find(p => p.id === state.selectedPersonaId);
    const res = await callGemini(PROMPTS.GENERATE_SURVEYS(state.researchTopic, persona), "Generate questions.");
    if (res) setState({ aiSurveys: res.surveys, step: 4 });
  },
  
  async performInterview() {
    const persona = getAllPersonas().find(p => p.id === state.selectedPersonaId);
    const allQ = []; 
    [...state.aiSurveys, ...state.manualSurveys].forEach(s => s.questions.forEach((q, idx) => allQ.push({ id: `${s.id}-${idx}`, text: q })));
    const selectedTexts = allQ.filter(q => state.selectedQuestionIds.includes(q.id)).map(q => q.text);
    if (selectedTexts.length === 0) { showToast("질문을 선택해 주세요."); return; }
    const res = await callGemini(PROMPTS.GENERATE_INTERVIEW(state.researchTopic, persona, selectedTexts), "Start interview.");
    if (res) setState({ 
      history: [...state.history, { personaId: persona.id, result: res }], 
      step: 6,
      selectedQaIndices: [],
      userInsight: ""
    });
  },
  
  async askFollowUp() {
    const input = document.getElementById('followup-input');
    const question = input?.value.trim(); if (!question) return;
    const curH = state.history[state.history.length - 1];
    const persona = getAllPersonas().find(p => p.id === curH.personaId);
    const res = await callGemini(PROMPTS.GENERATE_FOLLOW_UP(state.researchTopic, persona, question), "Ask follow-up.");
    if (res) { 
      const newH = [...state.history]; 
      newH[newH.length-1].result.qaPairs.push(res); 
      setState({ history: newH }); 
      input.value = ""; 
    }
  },

  toggleQaSelection(index) {
    let newList = [...state.selectedQaIndices];
    newList = newList.includes(index) ? newList.filter(x => x !== index) : [...newList, index];
    setState({ selectedQaIndices: newList });
  },

  updateUserInsight(text) {
    state.userInsight = text; 
  },

  async generateInferences() {
    const curH = state.history[state.history.length - 1];
    const persona = getAllPersonas().find(p => p.id === curH.personaId);
    
    let selectedQAs = curH.result.qaPairs.filter((_, i) => state.selectedQaIndices.includes(i));
    if(selectedQAs.length === 0) selectedQAs = curH.result.qaPairs;
    const qaText = selectedQAs.map(qa => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n');

    const insightInput = document.getElementById('user-insight-input');
    const userInsightVal = insightInput ? insightInput.value : state.userInsight;

    const res = await callGemini(
      PROMPTS.GENERATE_INFERENCES(state.researchTopic, persona, qaText, userInsightVal), 
      "Generate Inferences"
    );
    if (res && res.inferences) {
      const inferencesWithId = res.inferences.map((inf, i) => ({ ...inf, id: `inf-${Date.now()}-${i}` }));
      
      const historyCopy = [...state.history];
      historyCopy[historyCopy.length - 1].inferences = inferencesWithId;
      
      setState({ 
        currentInferences: inferencesWithId, 
        step: 7, 
        selectedInferenceId: null, 
        userInsight: userInsightVal,
        history: historyCopy
      });
    }
  },

  async generateConcepts(perspective = "종합적 관점") {
    const curH = state.history[state.history.length - 1];
    const persona = getAllPersonas().find(p => p.id === curH.personaId);
    
    let selectedQAs = curH.result.qaPairs.filter((_, i) => state.selectedQaIndices.includes(i));
    if(selectedQAs.length === 0) selectedQAs = curH.result.qaPairs;
    const qaText = selectedQAs.map(qa => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n');

    const inference = state.currentInferences.find(i => i.id === state.selectedInferenceId);
    if (!inference) { showToast("가장 중요한 핵심 가치(추론)를 선택해 주세요."); return; }

    setState({ currentPerspective: perspective });
    
    const res = await callGemini(
      PROMPTS.GENERATE_CONCEPTS(state.researchTopic, persona, qaText, state.userInsight, inference, perspective), 
      "Generate Concepts"
    );
    if (res && res.concepts) {
      const conceptsWithId = res.concepts.map((c, i) => ({ ...c, id: `c-${Date.now()}-${i}` }));
      
      const historyCopy = [...state.history];
      historyCopy[historyCopy.length - 1].perspective = perspective;
      historyCopy[historyCopy.length - 1].concepts = conceptsWithId;

      setState({ 
        currentConcepts: conceptsWithId, 
        step: 8, 
        selectedConceptId: null,
        history: historyCopy
      });
    }
  },

  async generateScenario() {
    const curH = state.history[state.history.length - 1];
    const persona = getAllPersonas().find(p => p.id === curH.personaId);
    const concept = state.currentConcepts.find(c => c.id === state.selectedConceptId);
    
    if(!concept) { showToast("컨셉을 선택해 주세요."); return; }

    const res = await callGemini(
      PROMPTS.GENERATE_SCENARIO(state.researchTopic, persona, concept), 
      "Generate Scenario"
    );
    if (res && res.scenario) {
      const historyCopy = [...state.history];
      historyCopy[historyCopy.length - 1].selectedConcept = concept;
      historyCopy[historyCopy.length - 1].scenario = res.scenario;

      setState({ 
        currentScenario: res.scenario, 
        step: 9,
        history: historyCopy
      });
    }
  }
};
window.Actions = Actions;

// --- PROJECT MODAL & LOAD LOGIC ---
window.loadProject = (id) => {
  let projects = {};
  try {
    projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)) || {};
  } catch(e) {}
  
  if(projects[id]) {
     const currentApiKey = state.apiKey;
     currentProjectId = id;
     setState({ ...projects[id].data, apiKey: currentApiKey, isAnalyzing: false });
     document.getElementById('project-modal')?.remove();
     showToast("프로젝트를 불러왔습니다.");
  }
};

window.deleteProject = (id) => {
  if(!confirm("이 프로젝트를 삭제하시겠습니까?")) return;
  let projects = {};
  try {
    projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)) || {};
  } catch(e) {}
  
  if(projects[id]) {
    delete projects[id];
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    
    const keys = Object.keys(projects).sort((a,b) => projects[b].updatedAt - projects[a].updatedAt);
    if(keys.length === 0) {
      document.getElementById('project-modal')?.remove();
      showToast("모든 프로젝트가 삭제되었습니다.");
    } else {
      const modalBody = document.querySelector('#project-modal .overflow-y-auto');
      if(modalBody) {
        modalBody.innerHTML = keys.map(k => {
          const p = projects[k];
          const date = new Date(p.updatedAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
          return `
            <div class="p-5 bg-slate-50 rounded-2xl mb-3 border border-slate-200 transition-colors flex items-center justify-between gap-3 hover:bg-blue-50">
              <div onclick="window.loadProject('${k}')" class="flex flex-col gap-1 flex-1 cursor-pointer overflow-hidden">
                <h4 class="font-extrabold text-[16px] text-slate-800 line-clamp-1">${p.title}</h4>
                <p class="text-[13px] text-slate-500 font-bold">${date}</p>
              </div>
              <button onclick="window.deleteProject('${k}')" class="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-full hover:bg-slate-200 shrink-0" title="삭제">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
              </button>
            </div>
          `;
        }).join('');
        lucide.createIcons();
      }
    }
  }
};

function showProjectSelectionModal(projects, keys) {
  const modal = document.createElement("div");
  modal.id = "project-modal";
  modal.className = "fixed inset-0 z-[10000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in";
  
  let listHtml = keys.map(k => {
    const p = projects[k];
    const date = new Date(p.updatedAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="p-5 bg-slate-50 rounded-2xl mb-3 border border-slate-200 transition-colors flex items-center justify-between gap-3 hover:bg-blue-50">
        <div onclick="window.loadProject('${k}')" class="flex flex-col gap-1 flex-1 cursor-pointer overflow-hidden">
          <h4 class="font-extrabold text-[16px] text-slate-800 line-clamp-1">${p.title}</h4>
          <p class="text-[13px] text-slate-500 font-bold">${date}</p>
        </div>
        <button onclick="window.deleteProject('${k}')" class="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-full hover:bg-slate-200 shrink-0" title="삭제">
          <i data-lucide="trash-2" class="w-5 h-5"></i>
        </button>
      </div>
    `;
  }).join('');

  modal.innerHTML = `
    <div class="bg-white rounded-[2rem] w-full max-w-[400px] max-h-[80vh] flex flex-col shadow-2xl overflow-hidden relative">
      <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
        <h3 class="font-black text-[18px] text-slate-900 pl-2">프로젝트 불러오기</h3>
        <button onclick="document.getElementById('project-modal').remove()" class="p-2 -mr-2 text-slate-400 hover:text-slate-700 transition-colors rounded-full hover:bg-slate-100">
          <i data-lucide="x" class="w-6 h-6"></i>
        </button>
      </div>
      <div class="p-6 overflow-y-auto flex-1 bg-white">
        ${listHtml}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  lucide.createIcons();
}

// --- CLIPBOARD UTILITIES ---
function copyReportToClipboard() {
  let txt = "==================================================\n   RESEARCH LAB. 분석 종합 리포트\n==================================================\n\n";
  txt += `[리서치 주제]\n- ${state.researchTopic || "설정된 주제 없음"}\n\n`;
  
  if (state.history.length > 0) {
    state.history.forEach((h, idx) => {
      const persona = getAllPersonas().find(p => p.id === h.personaId);
      txt += `==================================================\n`;
      txt += ` 타겟 #${idx+1} : ${persona?.name}\n`;
      txt += `==================================================\n`;
      
      txt += `[인터뷰 요약]\n${h.result.summary}\n\n`;
      
      txt += `[대화 내용 (Q&A)]\n`;
      h.result.qaPairs.forEach((qa, qidx) => { 
        txt += `Q${qidx+1}: ${qa.q}\nA: ${qa.a}\n\n`; 
      });
      
      txt += `[AI Key Insights]\n${h.result.keyInsights}\n\n`;

      if (h.inferences && h.inferences.length > 0) {
        txt += `[도출된 핵심 가치 추론]\n`;
        h.inferences.forEach((inf, i) => {
          txt += `${i+1}. ${inf.title}\n   ${inf.description}\n\n`;
        });
      }

      if (h.concepts && h.concepts.length > 0) {
        txt += `[도출된 디자인 컨셉 (${h.perspective || "종합적 관점"})]\n`;
        h.concepts.forEach((c, i) => {
          txt += `${i+1}. ${c.title}\n   핵심 가치: ${c.coreValue}\n   ${c.description}\n\n`;
        });
      }

      if (h.scenario) {
        txt += `[컨셉 시나리오 (${h.selectedConcept?.title})]\n${h.scenario}\n\n\n`;
      }
    });
  } else {
    txt += "저장된 인터뷰 기록이 없습니다.\n";
  }
  
  const textArea = document.createElement("textarea");
  textArea.value = txt;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    showToast("종합 리포트가 복사되었습니다.");
  } catch (err) {
    showToast("복사 실패.");
  }
  document.body.removeChild(textArea);
}
window.copyReportToClipboard = copyReportToClipboard;

function copyScenarioToClipboard() {
  const textArea = document.createElement("textarea");
  textArea.value = state.currentScenario;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    showToast("시나리오 내용이 복사되었습니다.");
  } catch (err) {
    showToast("복사 실패.");
  }
  document.body.removeChild(textArea);
}
window.copyScenarioToClipboard = copyScenarioToClipboard;

function showToast(message) {
  const toast = document.createElement("div");
  toast.innerText = message;
  toast.className = "fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-2xl text-[16px] font-semibold z-[10000] animate-fade-in shadow-xl backdrop-blur-md bg-opacity-90";
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
window.showToast = showToast;

function toggleQuestion(id) {
  let newList = [...state.selectedQuestionIds];
  newList = newList.includes(id) ? newList.filter(x => x !== id) : [...newList, id];
  setState({ selectedQuestionIds: newList });
}
window.toggleQuestion = toggleQuestion;

// --- RENDERERS ---
function renderHeader(title, prevStep) {
  const canGoNext = state.step < state.maxStepReached;
  return `
    <header class="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-slate-200/50 px-4 h-16 flex items-center justify-between max-w-[430px] mx-auto">
      <div class="flex items-center gap-1">
        <button onclick="setState({step: ${prevStep}})" class="p-2 -ml-2 rounded-full hover:bg-slate-100/80 transition-all text-slate-800">
          <i data-lucide="chevron-left" class="w-6 h-6"></i>
        </button>
        <h1 class="font-extrabold text-[17px] truncate ml-1 text-slate-900">${title}</h1>
      </div>
      <div class="flex items-center gap-1">
        ${canGoNext ? `<button onclick="setState({step: ${state.step + 1}})" class="p-2 rounded-full hover:bg-slate-100/80 text-slate-800 transition-all"><i data-lucide="chevron-right" class="w-6 h-6"></i></button>` : ""}
        <button onclick="copyReportToClipboard()" class="p-2 rounded-full hover:bg-slate-100/80 text-slate-800 transition-all"><i data-lucide="copy" class="w-5 h-5"></i></button>
        <button onclick="setState({step: 0})" class="p-2 rounded-full hover:bg-slate-100/80 text-slate-800 transition-all"><i data-lucide="home" class="w-5 h-5"></i></button>
      </div>
    </header>`;
}

function render() {
  const root = document.getElementById('root');
  let content = "";
  
  if (state.isAnalyzing) {
    content = `
      <div class="fixed inset-0 z-[9999] bg-white/80 backdrop-blur-xl flex flex-col items-center justify-center p-2 text-center max-w-[430px] mx-auto animate-fade-in spinner-container">
        <div class="w-16 h-16 border-[5px] border-slate-200 border-t-blue-600 rounded-full animate-spin mb-6 shadow-lg"></div>
        <h2 class="text-slate-900 font-extrabold text-2xl tracking-tight mb-2">AI 분석 중</h2>
      </div>`;
  }

  switch (state.step) {
    case -1: // API Key
      content += `
        <div class="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 text-center animate-fade-in relative overflow-hidden">
          <div class="absolute top-[-10%] right-[-20%] w-72 h-72 bg-blue-400/30 rounded-full blur-3xl"></div>
          <div class="absolute bottom-[-10%] left-[-20%] w-72 h-72 bg-blue-400/30 rounded-full blur-3xl"></div>
          
          <div class="z-10 w-full max-w-sm flex flex-col items-center">
            <h1 class="font-black tracking-tight text-slate-900 mb-3 text-[35px] leading-snug">Design Research<br/>Interview & Insight</h1>
            <p class="text-slate-600 font-bold mb-12 text-[16px]">디자인 리서치 자동화 도구</p>
            
            <div class="w-full bg-white p-6 rounded-3xl shadow-md border border-slate-200 api-key-form">
              <div class="mb-5 text-center">
                <a href="https://aistudio.google.com/app/apikey" target="_blank" class="text-blue-600 font-bold text-[16px] hover:underline underline-offset-4 flex items-center justify-center gap-1">
                  API Key 발급받기
                </a>
              </div>
              <input type="password" id="api-input" class="w-full h-14 bg-slate-50 border border-slate-300 rounded-2xl text-center focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none text-[16px] font-bold mb-4 transition-all text-slate-800" placeholder="Gemini API Key 입력">
              <button onclick="Actions.validateKey()" class="w-full h-14 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-bold text-[17px] shadow-md btn-active transition-colors">시작하기</button>
            </div>
          </div>
        </div>`;
      break;

    case 0: // Home
      content += `
        <div class="min-h-screen flex flex-col p-6 bg-dark-navy text-white relative overflow-hidden home-page">
          <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-blue-600/40 to-transparent rounded-full blur-3xl transform translate-x-1/3 -translate-y-1/3 gradient-blue"></div>
          
          <div class="flex-1 flex flex-col justify-center z-10 animate-fade-in mt-10">
            <div class="inline-block px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[11px] font-extrabold tracking-widest uppercase w-fit mb-6 border border-white/20 text-blue-100 researcher-badge">
              AI Researcher
            </div>
            <h1 class="text-[42px] font-black leading-[1.15] tracking-tight mb-6">사용자의<br/><span class="text-slate-900">깊은 속마음</span>을<br/><span class="text-blue-600">탐색하세요.</span></h1>
            <p class="text-slate-900 text-[16px] leading-relaxed font-bold">프로젝트의 방향을 결정지을<br/>가장 핵심적인 인사이트를 도출해 드립니다.</p>
          </div>
          
          <div class="space-y-4 pb-12 z-10 button-area">
            <button onclick="Actions.loadFromLocal()" class="w-full h-16 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl font-bold text-[17px] flex items-center justify-center gap-3 backdrop-blur-md transition-all btn-active text-slate-900">
              기존 프로젝트 열기
            </button>
            <button onclick="Actions.startNewProject()" class="w-full h-16 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-extrabold text-[17px] shadow-lg flex items-center justify-center gap-2 transition-all btn-active">
              새로운 인터뷰 시작
            </button>
          </div>
        </div>`;
      break;

    case 1: // Topic
      content += `
        <div class="pt-24 px-6 min-h-screen flex flex-col animate-fade-in bg-slate-50 topic-page">
          ${renderHeader("주제 설정", 0)}
          <div class="mb-8">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900 leading-snug">어떤 사용자 경험을<br/>개선하고 싶으신가요?</h2>
            <p class="text-slate-600 font-bold text-[15px]">해결하고자 하는 문제나 타겟 시장을 구체적으로 적어주시면 더 정확한 결과를 얻을 수 있습니다.</p>
          </div>
          <div class="relative bg-white rounded-3xl shadow-sm border border-slate-200 p-2 mb-20">
            <textarea id="topic-input" class="w-full h-64 p-5 bg-transparent border-none text-[17px] outline-none placeholder:text-slate-400 font-bold leading-relaxed resize-none text-slate-800" placeholder="예: 해외 여행 계획 시 정보의 파편화로 인해 피로도를 느끼는 1인 가구 직장인">${state.researchTopic}</textarea>
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-slate-50/90 backdrop-blur-lg border-t border-slate-200/50 max-w-[430px] mx-auto z-[60]">
            <button onclick="const val = document.getElementById('topic-input').value; if(val){ setState({researchTopic: val}); Actions.generatePersonas(); }" class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-md btn-active">타겟 12명 분석하기</button>
          </div>
        </div>`;
      break;

    case 2: // Personas (Grouped by Category)
      content += `
        <div class="pt-24 px-4 pb-64 animate-fade-in bg-slate-50 min-h-screen personas-page">
          ${renderHeader("타겟 제안", 1)}
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">핵심 인터뷰 타겟을 제안합니다</h2>
            <p class="text-blue-700 text-[16px] font-bold">4개 카테고리 타겟 General User, Lead User, Extreme User, Desire-Driven User</p>
          </div>
          
          <div class="space-y-12 mb-12 category-list px-2">
            ${state.aiCategories.map(cat => `
              <div class="space-y-4 category-item">
                <div class="bg-blue-100 border border-blue-200 p-5 rounded-3xl category-header">
                  <h3 class="font-black text-[18px] text-blue-900 mb-2 flex items-center gap-2">
                    <div class="w-2 h-6 bg-blue-600 rounded-full"></div> ${cat.categoryName}
                  </h3>
                  <p class="text-blue-800 font-bold text-[16px] leading-relaxed category-desc">${cat.categoryDesc}</p>
                </div>
                
                <div class="grid gap-4 persona-list">
                  ${cat.personas.map((p, i) => `
                    <div class="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden persona-card">
                      <h4 class="font-black text-[20px] text-slate-900 mb-3 mt-0 persona-name">${p.name}</h4>
                      <p class="text-[16px] text-slate-700 font-bold mb-5 leading-relaxed whitespace-pre-line persona-description">${p.description}</p>
                      <div class="bg-slate-50 px-4 py-4 rounded-2xl text-[16px] text-slate-700 font-bold border border-slate-200 needs-area">
                        <span class="font-extrabold text-blue-700 block mb-1">핵심 니즈</span>
                        ${p.needs}
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
            
            ${state.manualPersonas.length > 0 ? `
              <div class="space-y-4 category-item manual-category">
                <div class="bg-dark-navy p-5 rounded-3xl category-header">
                  <h3 class="font-black text-[18px] text-white flex items-center gap-2">사용자 직접 추가</h3>
                </div>
                <div class="grid gap-4 persona-list">
                  ${state.manualPersonas.map((p, i) => `
                    <div class="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm persona-card">
                      <h4 class="font-black text-[20px] text-slate-900 mb-3 persona-name">${p.name}</h4>
                      <p class="text-[16px] text-slate-700 font-bold whitespace-pre-line persona-description">${p.description}</p>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <div class="space-y-4 mb-10 px-2 manual-persona-form">
            <div class="bg-white p-5 rounded-3xl shadow-sm border border-slate-200">
              <h4 class="text-[16px] font-extrabold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                 <i data-lucide="pen-tool" class="w-5 h-5"></i> 직접 타겟 추가
              </h4>
              <input type="text" id="manual-p-name" class="w-full p-4 bg-slate-100 border-none rounded-2xl text-[16px] font-bold outline-none mb-3 focus:ring-2 focus:ring-blue-300 transition-all text-slate-800 placeholder:text-slate-500" placeholder="이름 및 특징 (예: 프로 출장러 김철수)">
              <textarea id="manual-p-desc" class="w-full p-4 bg-slate-100 border-none rounded-2xl text-[16px] h-28 outline-none resize-none mb-3 focus:ring-2 focus:ring-blue-300 transition-all text-slate-800 placeholder:text-slate-500 font-bold" placeholder="상세 설명과 니즈를 입력하세요"></textarea>
              <button onclick="Actions.addManualPersona()" class="w-full h-12 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold text-[16px] btn-active add-btn">목록에 추가</button>
            </div>
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-slate-50/90 backdrop-blur-lg border-t border-slate-200/50 max-w-[430px] mx-auto z-[60]">
            <button onclick="setState({step: 3})" class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-md btn-active select-btn">인터뷰 대상 선택하기</button>
          </div>
        </div>`;
      break;

    case 3: // Select Persona
      content += `
        <div class="pt-24 px-4 pb-40 animate-fade-in bg-slate-50 min-h-screen select-persona-page">
          ${renderHeader("대상 선택", 2)}
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900 leading-snug">누구와 먼저<br/>대화를 나눌까요?</h2>
          </div>
          
          <div class="px-2">
            ${state.aiCategories.map(cat => `
              <div class="mt-8 mb-4">
                <h3 class="font-extrabold text-[18px] text-slate-800 flex items-center gap-2">
                  <div class="w-1 h-5 bg-blue-600 rounded-full"></div> ${cat.categoryName}
                </h3>
              </div>
              <div class="grid gap-4">
                ${cat.personas.map((p, i) => {
                  const isDone = state.history.some(h => h.personaId === p.id);
                  const isSel = state.selectedPersonaId === p.id;
                  return `
                  <div onclick="${isDone ? '' : `setState({selectedPersonaId: '${p.id}', aiSurveys: [], manualSurveys: [], selectedQuestionIds: []})`}" 
                       class="p-5 rounded-[2rem] border-2 transition-all cursor-pointer persona-item ${isDone ? 'opacity-60 bg-slate-100 border-slate-300' : (isSel ? 'border-blue-600 bg-white shadow-lg scale-[1.02]' : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md')}">
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isSel ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'} font-black text-sm">
                          ${isSel ? '<i data-lucide="check" class="w-4 h-4"></i>' : (i + 1)}
                        </div>
                        <h3 class="font-extrabold text-[18px] text-slate-900 line-clamp-1">${p.name}</h3>
                      </div>
                      ${isDone ? '<span class="text-[11px] font-extrabold px-2 py-1 bg-slate-300 text-slate-700 rounded-md">인터뷰 완료</span>' : ''}
                    </div>
                    <p class="text-[16px] text-slate-600 font-bold line-clamp-2 mt-2 pl-11">${p.description}</p>
                  </div>`;
                }).join('')}
              </div>
            `).join('')}

            ${state.manualPersonas.length > 0 ? `
              <div class="mt-8 mb-4">
                <h3 class="font-extrabold text-[18px] text-slate-800 flex items-center gap-2">
                  <div class="w-1 h-5 bg-blue-600 rounded-full"></div> 사용자 직접 추가
                </h3>
              </div>
              <div class="grid gap-4 mb-4">
                ${state.manualPersonas.map((p, i) => {
                  const isDone = state.history.some(h => h.personaId === p.id);
                  const isSel = state.selectedPersonaId === p.id;
                  return `
                  <div onclick="${isDone ? '' : `setState({selectedPersonaId: '${p.id}', aiSurveys: [], manualSurveys: [], selectedQuestionIds: []})`}" 
                       class="p-5 rounded-[2rem] border-2 transition-all cursor-pointer persona-item ${isDone ? 'opacity-60 bg-slate-100 border-slate-300' : (isSel ? 'border-blue-600 bg-white shadow-lg scale-[1.02]' : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md')}">
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isSel ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'} font-black text-sm">
                          ${isSel ? '<i data-lucide="check" class="w-4 h-4"></i>' : '-'}
                        </div>
                        <h3 class="font-extrabold text-[18px] text-slate-900 line-clamp-1">${p.name}</h3>
                      </div>
                      ${isDone ? '<span class="text-[11px] font-extrabold px-2 py-1 bg-slate-300 text-slate-700 rounded-md">인터뷰 완료</span>' : ''}
                    </div>
                    <p class="text-[16px] text-slate-600 font-bold line-clamp-2 mt-2 pl-11">${p.description}</p>
                  </div>`;
                }).join('')}
              </div>
            ` : ''}
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-slate-50/90 backdrop-blur-lg border-t border-slate-200/50 max-w-[430px] mx-auto z-[60]">
            <button onclick="Actions.generateSurveys()" ${!state.selectedPersonaId ? 'disabled' : ''} 
              class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] btn-active shadow-lg disabled:opacity-50 disabled:scale-100 transition-all">
              질문 리스트 생성
            </button>
          </div>
        </div>`;
      break;

    case 4: // Select Questions
      const combinedSurveys = [...state.aiSurveys, ...state.manualSurveys];
      content += `
        <div class="pt-24 px-4 pb-64 animate-fade-in bg-slate-50 min-h-screen survey-page">
          ${renderHeader("질문 설계", 3)}
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">핵심 질문을<br/>골라주세요</h2>
            <p class="text-blue-700 text-[16px] font-extrabold">인터뷰의 뼈대가 될 질문들을 선택합니다.</p>
          </div>
          
          <div class="space-y-10 mb-10 px-2 survey-list">
            ${combinedSurveys.map(s => `
              <div class="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm survey-card">
                <h3 class="font-extrabold text-[18px] text-slate-900 mb-5 flex items-center gap-2 survey-title">
                  <div class="w-1.5 h-5 bg-blue-600 rounded-full"></div> ${s.title}
                </h3>
                <div class="space-y-3 question-list">
                  ${s.questions.map((q, idx) => {
                    const qId = `${s.id}-${idx}`; 
                    const isSel = state.selectedQuestionIds.includes(qId);
                    return `
                      <div onclick="toggleQuestion('${qId}')" class="p-4 rounded-2xl border-2 transition-all cursor-pointer flex gap-4 items-start question-item ${isSel ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 bg-slate-50 hover:bg-slate-100'}">
                        <div class="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${isSel ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'} text-white check-icon">
                          ${isSel ? `<i data-lucide="check" class="w-3.5 h-3.5"></i>` : ""}
                        </div>
                        <p class="text-[16px] ${isSel ? 'text-blue-900 font-extrabold' : 'text-slate-700 font-bold'} flex-1 leading-snug question-text">${q}</p>
                      </div>`;
                  }).join('')}
                </div>
              </div>`).join('')}
          </div>
          
          <div class="bg-slate-200/60 p-6 mx-2 rounded-[2rem] border border-slate-300 space-y-4 mb-10 manual-question-form">
            <h4 class="text-[16px] font-extrabold text-slate-600 uppercase tracking-wider flex items-center gap-2 manual-title">
              <i data-lucide="plus-circle" class="w-5 h-5"></i> 직접 질문 추가
            </h4>
            <textarea id="manual-q-input" class="w-full p-4 bg-white border-none rounded-2xl text-[16px] h-28 outline-none focus:ring-2 focus:ring-blue-300 transition-all placeholder:text-slate-500 font-bold resize-none text-slate-900 manual-textarea" placeholder="엔터키로 구분하여 질문을 입력하세요"></textarea>
            <button onclick="Actions.addManualQuestions()" class="w-full h-12 bg-slate-800 text-white rounded-xl font-bold text-[16px] btn-active add-btn">추가하기</button>
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-slate-50/90 backdrop-blur-lg border-t border-slate-200/50 max-w-[430px] mx-auto z-[60] next-btn-area">
            <button onclick="if(state.selectedQuestionIds.length > 0) setState({step: 5})" ${state.selectedQuestionIds.length === 0 ? 'disabled' : ''} 
              class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-md disabled:opacity-50 btn-active transition-all confirm-btn">
              질문 확정 (${state.selectedQuestionIds.length}개)
            </button>
          </div>
        </div>`;
      break;

    case 5: // Confirm
      const finalQList = [];
      [...state.aiSurveys, ...state.manualSurveys].forEach(s => s.questions.forEach((q, i) => { if(state.selectedQuestionIds.includes(`${s.id}-${i}`)) finalQList.push(q); }));
      const selectedP = getAllPersonas().find(p => p.id === state.selectedPersonaId);
      
      content += `
        <div class="pt-24 px-6 pb-44 animate-fade-in bg-slate-50 min-h-screen confirm-page">
          ${renderHeader("인터뷰 시작", 4)}
          <div class="mb-10 text-center mt-4 confirm-header">
            <div class="w-20 h-20 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm border border-blue-200 spinner-area">
               <i data-lucide="mic" class="w-10 h-10"></i>
            </div>
            <h2 class="text-2xl font-black tracking-tight text-slate-900 mb-2">인터뷰 준비 완료</h2>
            <p class="text-slate-600 font-bold text-[16px]">아래 대상과 가상 인터뷰를 진행합니다.</p>
          </div>
          
          <div class="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-md mb-8 persona-card">
            <div class="mb-6 border-b border-slate-200 pb-5 text-center persona-header">
              <h3 class="font-extrabold text-[22px] text-blue-900">${selectedP?.name}</h3>
            </div>
            <div class="space-y-4 max-h-72 overflow-y-auto pr-2 no-scrollbar font-bold question-list">
              ${finalQList.map((q, i) => `
                <div class="flex gap-3 text-[15px] bg-slate-50 p-4 rounded-2xl border border-slate-100 question-item">
                  <span class="font-black text-blue-600 shrink-0 select-none">Q${i+1}.</span> 
                  <p class="text-slate-800">${q}</p>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-slate-50/90 backdrop-blur-lg border-t border-slate-200/50 max-w-[430px] mx-auto z-[60] next-btn-area">
            <button onclick="Actions.performInterview()" class="w-full h-16 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-black text-[18px] btn-active shadow-xl flex justify-center items-center gap-2 start-btn">
              <i data-lucide="play-circle" class="w-6 h-6"></i> 대화 시작하기
            </button>
          </div>
        </div>`;
      break;

    case 6: // Step 6: Interview Progress (인터뷰 진행)
      const curH = state.history[state.history.length-1];
      const curPersona = getAllPersonas().find(p => p.id === curH.personaId);
      
      content += `
        <div class="pt-24 px-4 pb-[150px] animate-fade-in bg-slate-50 min-h-screen">
          ${renderHeader("인터뷰 진행", 5)}
          
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">가상의 인터뷰 대화를<br/>진행해 주세요</h2>
            <p class="text-blue-700 text-[16px] font-bold">타겟의 답변을 검토하고 추가 질문을 통해 인터뷰를 마무리합니다.</p>
          </div>

          <div class="space-y-6 mb-12 px-2">
            ${curH.result.qaPairs.map((qa, i) => `
              <div class="p-6 rounded-[2rem] border-2 border-slate-200 bg-white shadow-sm">
                <div class="flex gap-3 mb-4 pr-8">
                  <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center shrink-0 text-sm">Q${i+1}</div>
                  <div class="text-slate-900 font-extrabold text-[16px] leading-snug pt-1">${qa.q}</div>
                </div>
                <div class="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-slate-700 font-bold text-[16px] leading-relaxed">
                  ${qa.a}
                </div>
              </div>`).join('')}
          </div>
          
          <div class="p-6 mx-2 bg-white border border-slate-200 rounded-3xl mb-12 shadow-sm">
            <h4 class="text-[16px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-4">
              <i data-lucide="message-square-plus" class="w-5 h-5"></i> 추가 질문하기
            </h4>
            <div class="flex gap-2">
              <input type="text" id="followup-input" class="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-[16px] outline-none focus:ring-2 focus:ring-blue-200 font-bold placeholder:text-slate-400 text-slate-900" placeholder="더 궁금한 점을 물어보세요">
              <button onclick="Actions.askFollowUp()" class="shrink-0 w-14 h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl shadow-md flex items-center justify-center btn-active transition-colors">
                <i data-lucide="send" class="w-5 h-5"></i>
              </button>
            </div>
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-slate-50/90 backdrop-blur-lg border-t border-slate-200/50 max-w-[430px] mx-auto z-[60]">
            <button onclick="setState({step: 7})" class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-lg btn-active">
              인터뷰 최종 결과 확인하기
            </button>
          </div>
        </div>`;
      break;

    case 7: // Step 7: New Interview Result Review Page (인터뷰 결과)
      const lastH = state.history[state.history.length-1];
      content += `
        <div class="pt-24 px-4 pb-[380px] animate-fade-in bg-slate-50 min-h-screen">
          ${renderHeader("인터뷰 결과", 6)}
          
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">중요한 인사이트를<br/>선택해 주세요</h2>
            <p class="text-blue-700 text-[16px] font-bold">선택된 대화와 아래 작성 내용을 바탕으로 컨셉이 도출됩니다.</p>
          </div>

          <div class="mb-8 p-8 mx-2 bg-gradient-to-br from-blue-900 to-sky-950 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
            <div class="absolute top-0 right-0 w-32 h-32 bg-blue-500/30 blur-2xl rounded-full"></div>
            <div class="inline-block px-3 py-1 bg-white/20 rounded-full text-[11px] font-extrabold tracking-widest uppercase mb-4 border border-white/20">Summary</div>
            <h2 class="text-[26px] font-black mb-5 leading-tight text-white">${getAllPersonas().find(p => p.id === lastH.personaId)?.name}</h2>
            <p class="text-blue-50 text-[16px] leading-relaxed whitespace-pre-line font-bold opacity-90">${lastH.result.summary}</p>
          </div>
          
          <div class="space-y-6 mb-12 px-2">
            <h3 class="font-black text-[18px] text-slate-900 px-2 flex items-center gap-2">
              <i data-lucide="message-square" class="w-5 h-5"></i> 대화 내용 (Q&A)
            </h3>
            ${lastH.result.qaPairs.map((qa, i) => {
              const isSel = state.selectedQaIndices.includes(i);
              return `
              <div onclick="Actions.toggleQaSelection(${i})" class="p-6 rounded-[2rem] border-2 transition-all cursor-pointer bg-white relative ${isSel ? 'border-blue-600 shadow-md ring-2 ring-blue-600/20' : 'border-slate-200 shadow-sm'}">
                <div class="absolute top-6 right-6 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSel ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'}">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i>
                </div>
                <div class="flex gap-3 mb-4 pr-8">
                  <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center shrink-0 text-sm">Q${i+1}</div>
                  <div class="text-slate-900 font-extrabold text-[16px] leading-snug pt-1">${qa.q}</div>
                </div>
                <div class="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-slate-700 font-bold text-[16px] leading-relaxed">
                  ${qa.a}
                </div>
              </div>`
            }).join('')}
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-200 max-w-[430px] mx-auto z-[60] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
            <h4 class="text-[16px] font-extrabold text-slate-800 mb-3 flex items-center gap-2">
              <i data-lucide="lightbulb" class="w-5 h-5 text-amber-500"></i> 직접 발견한 인사이트 (필요시 입력)
            </h4>
            <textarea id="user-insight-input" onchange="Actions.updateUserInsight(this.value)" class="w-full p-4 bg-slate-50 border-2 border-blue-600 rounded-2xl text-[16px] h-32 outline-none focus:ring-2 focus:ring-blue-300 transition-all placeholder:text-slate-500 font-bold resize-none mb-4 text-slate-900" placeholder="인터뷰를 통해 느낀 점이나 아이디어를 적어주세요">${state.userInsight}</textarea>
            
            <button onclick="Actions.generateInferences()" class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-lg btn-active">
              핵심 가치 추론하기
            </button>
          </div>
        </div>`;
      break;

    case 8: // Inferences 도출
      content += `
        <div class="pt-24 px-4 pb-[200px] animate-fade-in bg-slate-50 min-h-screen">
          ${renderHeader("핵심 가치 추론", 7)}
          
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">인터뷰 기반<br/>핵심 가치 추론</h2>
            <p class="text-blue-700 text-[16px] font-bold">사용자에게 가장 중요한 가치를 선택해 주세요.</p>
          </div>

          <div class="space-y-4 mb-10 px-2">
            ${state.currentInferences.map((inf, i) => {
              const isSel = state.selectedInferenceId === inf.id;
              return `
              <div onclick="setState({selectedInferenceId: '${inf.id}'})" class="p-6 rounded-[2rem] border-2 transition-all cursor-pointer bg-white relative ${isSel ? 'border-blue-600 shadow-md ring-2 ring-blue-600/20' : 'border-slate-200 shadow-sm'}">
                <div class="absolute top-6 right-6 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSel ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'}">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i>
                </div>
                <div class="inline-block px-3 py-1 bg-blue-50 text-blue-700 rounded-md text-[11px] font-extrabold tracking-widest uppercase mb-3 border border-blue-100">Inference ${i+1}</div>
                <h3 class="font-extrabold text-[18px] text-slate-900 mb-3 pr-8 leading-snug">${inf.title}</h3>
                <p class="text-slate-700 font-bold text-[16px] leading-relaxed whitespace-pre-line">${inf.description}</p>
              </div>`
            }).join('')}
          </div>

          <div class="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-200 max-w-[430px] mx-auto z-[60] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
            <button onclick="Actions.generateConcepts()" ${!state.selectedInferenceId ? 'disabled' : ''} class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-lg disabled:opacity-50 btn-active">
              선택한 추론으로 디자인 컨셉 도출
            </button>
          </div>
        </div>`;
      break;

    case 9: // Design Concepts & Perspectives
      const perspectives = ["종합적 관점", "독창성 관점", "기술적 관점", "비즈니스 관점"];
      content += `
        <div class="pt-24 px-4 pb-[300px] animate-fade-in bg-slate-50 min-h-screen">
          ${renderHeader("컨셉 도출", 8)}
          
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">핵심 추론 기반<br/>디자인 컨셉</h2>
            <p class="text-blue-700 text-[16px] font-bold">마음에 드는 컨셉 하나를 선택해 시나리오를 확인하세요.</p>
          </div>

          <div class="space-y-4 mb-10 px-2">
            ${state.currentConcepts.map((c, i) => {
              const isSel = state.selectedConceptId === c.id;
              return `
              <div onclick="setState({selectedConceptId: '${c.id}'})" class="p-6 rounded-[2rem] border-2 transition-all cursor-pointer bg-white relative ${isSel ? 'border-blue-600 shadow-md ring-2 ring-blue-600/20' : 'border-slate-200 shadow-sm'}">
                <div class="absolute top-6 right-6 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSel ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'}">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i>
                </div>
                <div class="inline-block px-3 py-1 bg-blue-50 text-blue-700 rounded-md text-[11px] font-extrabold tracking-widest uppercase mb-3 border border-blue-100">Concept ${i+1}</div>
                <h3 class="font-extrabold text-[18px] text-slate-900 mb-2 pr-8 leading-snug">${c.title}</h3>
                <p class="font-extrabold text-blue-700 block mb-3 text-[14px]">핵심 가치: ${c.coreValue}</p>
                <p class="text-slate-700 font-bold text-[16px] leading-relaxed whitespace-pre-line">${c.description}</p>
              </div>`
            }).join('')}
          </div>

          <div class="mb-10 px-2">
            <button onclick="setState({step: 3})" class="w-full h-14 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors btn-active shadow-sm">
              <i data-lucide="users" class="w-5 h-5"></i> 다른 타겟 인터뷰하기
            </button>
          </div>

          <div class="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-200 max-w-[430px] mx-auto z-[60] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
            <div class="grid grid-cols-2 gap-2 mb-4">
              ${perspectives.map(p => {
                const isActive = state.currentPerspective === p;
                return `
                <button onclick="Actions.generateConcepts('${p}')" class="py-3 rounded-xl font-bold text-[14px] border transition-all ${isActive ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}">
                  ${p}
                </button>`
              }).join('')}
            </div>
            <button onclick="Actions.generateScenario()" ${!state.selectedConceptId ? 'disabled' : ''} class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-lg disabled:opacity-50 btn-active">
              컨셉 시나리오 보기
            </button>
          </div>
        </div>`;
      break;

    case 10: // Concept Scenario
      content += `
        <div class="pt-24 px-6 pb-40 animate-fade-in bg-slate-50 min-h-screen">
          ${renderHeader("컨셉 시나리오", 9)}
          
          <div class="mb-8">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900 leading-snug">사용자 경험<br/>시나리오</h2>
            <p class="text-blue-700 text-[16px] font-bold">선택하신 컨셉이 적용된 미래의 모습을 확인하세요.</p>
          </div>

          <div class="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-md mb-8 relative">
            <button onclick="copyScenarioToClipboard()" class="absolute top-6 right-6 p-2 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-lg transition-colors" title="시나리오 복사하기">
              <i data-lucide="copy" class="w-5 h-5"></i>
            </button>
            <div class="text-slate-900 font-bold text-[16px] leading-loose whitespace-pre-line mt-4">
              ${state.currentScenario}
            </div>
          </div>

          <div class="fixed bottom-0 left-0 right-0 p-6 bg-slate-50/90 backdrop-blur-lg border-t border-slate-200/50 max-w-[430px] mx-auto space-y-3 z-[60]">
            <button onclick="copyReportToClipboard()" class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[16px] shadow-lg btn-active flex items-center justify-center gap-2">
              <i data-lucide="copy" class="w-5 h-5"></i> 전체 리포트 복사하기
            </button>
            <button onclick="setState({step: 0})" class="w-full h-14 bg-white border border-slate-200 text-slate-700 rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors btn-active shadow-sm">
              <i data-lucide="home" class="w-5 h-5"></i> 처음으로 돌아가기
            </button>
          </div>
        </div>`;
      break;
  }
  
  root.innerHTML = `<div class="w-full max-w-[430px] mx-auto min-h-screen shadow-[0_0_50px_rgba(0,0,0,0.05)] relative overflow-x-hidden bg-slate-50">${content}</div>`;
  lucide.createIcons();
}

// --- BOOTSTRAP ---
window.onload = () => {
  render();
  setInterval(() => {
    if (state.step > 0 || (state.step === 1 && state.researchTopic.trim() !== "")) {
      const { apiKey, isAnalyzing, errorMsg, ...dataToSave } = state;
      
      let projects = {};
      try {
        projects = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)) || {};
      } catch(e) {}

      if (!currentProjectId) {
        currentProjectId = 'proj_' + Date.now();
      }

      let title = state.researchTopic.trim();
      if (!title) title = "새 프로젝트 " + new Date().toLocaleTimeString();
      else if (title.length > 20) title = title.substring(0, 20) + "...";

      projects[currentProjectId] = {
        id: currentProjectId,
        title: title,
        updatedAt: Date.now(),
        data: dataToSave
      };

      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    }
  }, 5000);
};
