// script.js

// --- CONFIG & CONSTANTS ---
// 모델명 고정 (절대 변경 금지)
const MODEL_NAME = "gemini-flash-latest"; 
const SESSION_KEY_API = "research_lab_api_key_v31";
const PROJECTS_STORAGE_KEY = "research_lab_projects_v31"; // 다중 프로젝트 저장을 위한 키 변경
let currentProjectId = null; // 현재 진행 중인 프로젝트 ID

// --- SECURITY HELPER ---
// 사용자/AI가 생성한 텍스트를 HTML에 삽입하기 전 반드시 이 함수를 통과시킨다 (XSS 방지)
function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- PROMPT TEMPLATES ---
// (API를 "호출하는 방식"은 변경하지 않았습니다. 아래는 전달되는 지시문의 "내용"만 개선한 것입니다.)
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
  - 12명의 페르소나는 연령대, 성별, 직업, 라이프스타일이 서로 겹치지 않도록 최대한 다양하게 구성해 주세요. (예: 30대 직장인만 반복되지 않도록 주의)
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

  GENERATE_SINGLE_PERSONA: (topic, categoryName, categoryDesc, existingNames) => `You are a Senior UX/User Researcher. Topic: "${topic}".
  카테고리: "${categoryName}" (${categoryDesc})
  이미 존재하는 페르소나들: ${existingNames}

  위 카테고리에 어울리는 새로운 페르소나 1명을 제안해 주세요. 반드시 기존 페르소나들과 연령대, 직업, 라이프스타일이 겹치지 않는 새로운 인물이어야 합니다.
  [STRICT RULE]
  - 이름은 반드시 "김민준", "이서윤" 같은 한국식 가상의 이름을 사용해 주세요. (예: 콘텐츠 유목민: 30대 김민준)
  - "description"은 2줄 이상, "needs"는 2줄 이상 상세히 작성해 주세요.
  - 모든 문장은 전문적이고 명확한 존댓말을 사용해 주세요.
  Return JSON: { "persona": { "name": "...", "description": "...", "needs": "..." } }`,

  GENERATE_SURVEYS: (topic, persona) => `You are an Expert UX Interviewer. Topic: "${topic}". Persona: "${persona.name}".
  Suggest exactly 15 in-depth interview questions organized into 3 categories (5 per category). 
  [STYLE] Write in clear, straightforward, and conversational Korean. 모든 문장은 존댓말을 사용해 주세요.
  Return JSON: { "surveys": [{ "id": "uuid", "title": "Category Title", "questions": ["Question 1", "Question 2", "..."] }] }.`,

  GENERATE_INTERVIEW: (topic, persona, questions) => `You are a Virtual User named ${persona.name}. Topic: "${topic}". 
  Context: ${persona.description}. Needs: ${persona.needs}.
  Answer ALL the following questions realistically as this persona:
  ${questions.map((q, i) => `${i+1}. ${q}`).join("\n")}
  [RULE] 각 질문에 대한 답변은 5문장 정도로 상세하게 작성해 주세요. 페르소나의 성격이 드러나는 구체적인 에피소드를 반드시 포함하세요. 모든 답변은 하나의 일관된 성격과 배경을 가진 같은 인물이 말하는 것처럼 서로 모순되지 않아야 합니다. Markdown bold(**) 사용 금지. 모든 문장은 존댓말을 사용해 주세요.
  [FORMAT] For "keyInsights", use 1) 2) 3) format.
  Return JSON: { "summary": "Full session summary", "qaPairs": [{ "q": "Question Text", "a": "Answer Text" }], "keyInsights": "1) ... \\n 2) ..." }.`,

  // 개선: 이전 대화 맥락(priorQAs)을 함께 전달하여 팔로업 답변이 이전 답변과 일관되도록 함
  GENERATE_FOLLOW_UP: (topic, persona, priorQAs, question) => `You are a Virtual User named ${persona.name}. Topic: "${topic}".
  Context: ${persona.description}. Needs: ${persona.needs}.
  [이전 인터뷰 대화 내용 - 반드시 참고하여 일관된 성격/의견으로 답변할 것]
  ${(priorQAs || []).map(qa => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n')}

  [추가 질문]
  "${question}"
  [RULE] 위 이전 답변들과 성격, 배경, 의견이 일관되게 답변하세요. Easy Korean. No markdown bold (**). 모든 문장은 존댓말을 사용해 주세요.
  Return JSON: { "q": "${question}", "a": "Answer" }.`,

  GENERATE_INFERENCES: (topic, persona, qaText, userInsight, perspective) => `You are a Senior UX Strategist. Topic: "${topic}". Persona: "${persona.name}".
  [선택된 주요 대화 종합]
  ${qaText}
  [사용자 직접 작성 인사이트]
  ${userInsight || "작성된 내용 없음"}

  위 인터뷰 내용 전체와 사용자 인사이트를 파편적으로 보지 않고 종합적으로 분석하여, "${perspective}"에서 사용자에게 가장 중요한 핵심 가치를 도출하는 "추론(Inference)" 3가지를 작성해 주세요. (개별 대화에 대한 1:1 답변이 아닌 융합적이고 종합적인 추론이어야 합니다.)

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
  editingQuestionKey: null, // 질문 인라인 수정 중인 항목 키
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

// 개선: history 배열 안의 "마지막 세션 객체"를 안전하게 복제해서 반환.
// 기존 코드는 [...state.history] 로 배열만 복사하고 내부 세션 객체는 직접 mutate 하는 버그가 있었음.
function cloneLastSession() {
  const newH = [...state.history];
  const idx = newH.length - 1;
  if (idx < 0) return { newH, session: null };
  const session = { ...newH[idx] };
  newH[idx] = session;
  return { newH, session };
}

// --- API CALL ---
// (이하 callGemini 함수는 기존 API 호출/재시도/백오프 로직을 그대로 유지합니다. 수정하지 않았습니다.)
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
    // 수정: 기존 코드는 "test && test.status === 'OK' || test" 로 되어 있어
    // status 값과 무관하게 응답만 있으면 통과하는 논리 버그가 있었음.
    if (test && test.status === "OK") {
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
      editingQuestionKey: null,
      history: [], isAnalyzing: false, errorMsg: null,
      selectedQaIndices: [], userInsight: "", currentInferences: [], selectedInferenceId: null, currentConcepts: [], currentPerspective: "종합적 관점", selectedConceptId: null, currentScenario: ""
    };
    currentProjectId = null; 
    setState({ ...initialState, apiKey: currentApiKey });
  },

  async generatePersonas(instruction = "") {
    const userPrompt = instruction ? `Topic: ${state.researchTopic}. 추가 지시사항: ${instruction}` : state.researchTopic;
    const res = await callGemini(PROMPTS.GENERATE_PERSONAS(state.researchTopic), userPrompt);
    // 개선: AI가 준 id를 그대로 믿지 않고 클라이언트에서 안전한 id를 재부여 (속성 인젝션 방지 + 중복id 방지)
    if (res && Array.isArray(res.categories)) {
      const categoriesWithIds = res.categories.map((cat, ci) => ({
        ...cat,
        personas: (cat.personas || []).map((p, pi) => ({ ...p, id: `p_${ci}_${pi}_${Date.now()}` }))
      }));
      setState({ aiCategories: categoriesWithIds, step: 2 });
    } else {
      showToast("페르소나 생성에 실패했습니다. 다시 시도해 주세요.");
    }
  },

  // 신규: 카드 하나만 다시 생성
  async regeneratePersona(catIndex, personaIndex) {
    const cat = state.aiCategories[catIndex];
    if (!cat) return;
    const existingNames = cat.personas.map(p => p.name).join(', ');
    const res = await callGemini(
      PROMPTS.GENERATE_SINGLE_PERSONA(state.researchTopic, cat.categoryName, cat.categoryDesc, existingNames),
      "Generate one replacement persona."
    );
    if (res && res.persona) {
      const newCategories = state.aiCategories.map((c, ci) => {
        if (ci !== catIndex) return c;
        const newPersonas = c.personas.map((p, pi) => pi === personaIndex
          ? { ...res.persona, id: `p_${catIndex}_${personaIndex}_${Date.now()}` }
          : p);
        return { ...c, personas: newPersonas };
      });
      setState({ aiCategories: newCategories });
      showToast("페르소나를 새로 생성했습니다.");
    } else {
      showToast("재생성에 실패했습니다. 다시 시도해 주세요.");
    }
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
    if (res && Array.isArray(res.surveys)) {
      const surveysWithIds = res.surveys.map((s, si) => ({ ...s, id: `sv_${si}_${Date.now()}` }));
      setState({ aiSurveys: surveysWithIds, step: 4 });
    } else {
      showToast("질문 생성에 실패했습니다. 다시 시도해 주세요.");
    }
  },

  // 신규: 질문 인라인 수정
  editQuestion(qId) {
    setState({ editingQuestionKey: qId });
  },

  saveQuestionEdit(qId) {
    const input = document.getElementById('qedit-' + qId);
    const val = input?.value.trim();
    if (!val) { showToast("질문 내용을 입력해주세요."); return; }
    const dashPos = qId.lastIndexOf('-');
    const surveyId = qId.substring(0, dashPos);
    const qIdx = parseInt(qId.substring(dashPos + 1), 10);
    const updateList = (list) => list.map(s => s.id === surveyId
      ? { ...s, questions: s.questions.map((qq, i) => i === qIdx ? val : qq) }
      : s);
    setState({
      aiSurveys: updateList(state.aiSurveys),
      manualSurveys: updateList(state.manualSurveys),
      editingQuestionKey: null
    });
    showToast("질문이 수정되었습니다.");
  },
  
  async performInterview() {
    const persona = getAllPersonas().find(p => p.id === state.selectedPersonaId);
    const allQ = []; 
    [...state.aiSurveys, ...state.manualSurveys].forEach(s => s.questions.forEach((q, idx) => allQ.push({ id: `${s.id}-${idx}`, text: q })));
    const selectedTexts = allQ.filter(q => state.selectedQuestionIds.includes(q.id)).map(q => q.text);
    if (selectedTexts.length === 0) { showToast("질문을 선택해 주세요."); return; }
    const res = await callGemini(PROMPTS.GENERATE_INTERVIEW(state.researchTopic, persona, selectedTexts), "Start interview.");
    if (res && Array.isArray(res.qaPairs)) {
      const sessionObj = {
        sessionId: 'sess_' + Date.now(),
        personaId: persona.id,
        result: { summary: res.summary || "", qaPairs: res.qaPairs, keyInsights: res.keyInsights || "" },
        selectedQaIndices: [],
        userInsight: "",
        inferences: [],
        inferencePerspective: "종합적 관점",
        selectedInferenceId: null,
        concepts: [],
        perspective: "종합적 관점",
        selectedConceptId: null,
        scenario: "",
        branches: [] // 다른 관점으로 다시 탐색했을 때의 이전 결과를 보존하는 공간
      };
      setState({ 
        history: [...state.history, sessionObj], 
        step: 6,
        selectedQaIndices: [],
        userInsight: ""
      });
    } else {
      showToast("인터뷰 생성에 실패했습니다. 다시 시도해 주세요.");
    }
  },
  
  async askFollowUp() {
    const input = document.getElementById('followup-input');
    const question = input?.value.trim(); if (!question) return;
    const { newH, session } = cloneLastSession();
    if (!session) return;
    const persona = getAllPersonas().find(p => p.id === session.personaId);
    // 개선: 이전 대화(qaPairs)를 함께 전달하여 일관된 답변 유도
    const res = await callGemini(PROMPTS.GENERATE_FOLLOW_UP(state.researchTopic, persona, session.result.qaPairs, question), "Ask follow-up.");
    if (res) { 
      session.result = { ...session.result, qaPairs: [...session.result.qaPairs, res] };
      setState({ history: newH }); 
      input.value = ""; 
    }
  },

  toggleQaSelection(index) {
    let newList = [...state.selectedQaIndices];
    newList = newList.includes(index) ? newList.filter(x => x !== index) : [...newList, index];
    const { newH, session } = cloneLastSession();
    if (session) session.selectedQaIndices = newList;
    setState({ selectedQaIndices: newList, history: newH });
  },

  // 신규: 전체 선택 / 선택 해제
  selectAllQa() {
    const { newH, session } = cloneLastSession();
    if (!session) return;
    const allIdx = session.result.qaPairs.map((_, i) => i);
    session.selectedQaIndices = allIdx;
    setState({ selectedQaIndices: allIdx, history: newH });
  },

  clearQaSelection() {
    const { newH, session } = cloneLastSession();
    if (!session) return;
    session.selectedQaIndices = [];
    setState({ selectedQaIndices: [], history: newH });
  },

  updateUserInsight(text) {
    // 수정: 기존에는 setState를 호출하지 않고 state를 직접 변경하여 렌더링/저장 로직과 어긋났음
    const { newH, session } = cloneLastSession();
    if (session) session.userInsight = text;
    setState({ userInsight: text, history: newH });
  },

  async generateInferences(perspective = "종합적 관점") {
    if (state.history.length === 0) return;
    const { newH, session } = cloneLastSession();
    const persona = getAllPersonas().find(p => p.id === session.personaId);
    
    let selectedQAs = session.result.qaPairs.filter((_, i) => state.selectedQaIndices.includes(i));
    if(selectedQAs.length === 0) selectedQAs = session.result.qaPairs;
    const qaText = selectedQAs.map(qa => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n');

    const insightInput = document.getElementById('user-insight-input');
    const userInsightVal = insightInput ? insightInput.value : state.userInsight;

    setState({ currentPerspective: perspective });

    const res = await callGemini(
      PROMPTS.GENERATE_INFERENCES(state.researchTopic, persona, qaText, userInsightVal, perspective), 
      "Generate Inferences"
    );
    if (res && Array.isArray(res.inferences)) {
      const inferencesWithId = res.inferences.map((inf, i) => ({ ...inf, id: `inf-${Date.now()}-${i}` }));
      
      session.inferencePerspective = perspective;
      session.inferences = inferencesWithId;
      session.selectedInferenceId = null; 
      session.userInsight = userInsightVal;
      
      setState({ 
        currentInferences: inferencesWithId, 
        step: 8, 
        selectedInferenceId: null, 
        userInsight: userInsightVal,
        history: newH
      });
    } else {
      showToast("추론 생성에 실패했습니다. 다시 시도해 주세요.");
    }
  },

  async generateConcepts(perspective = "종합적 관점") {
    if (state.history.length === 0) return;
    const { newH, session } = cloneLastSession();
    const persona = getAllPersonas().find(p => p.id === session.personaId);
    
    let selectedQAs = session.result.qaPairs.filter((_, i) => state.selectedQaIndices.includes(i));
    if(selectedQAs.length === 0) selectedQAs = session.result.qaPairs;
    const qaText = selectedQAs.map(qa => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n');

    const inference = state.currentInferences.find(i => i.id === state.selectedInferenceId);
    if (!inference) { showToast("가장 중요한 핵심 가치(추론)를 선택해 주세요."); return; }

    setState({ currentPerspective: perspective });
    
    const res = await callGemini(
      PROMPTS.GENERATE_CONCEPTS(state.researchTopic, persona, qaText, state.userInsight, inference, perspective), 
      "Generate Concepts"
    );
    if (res && Array.isArray(res.concepts)) {
      const conceptsWithId = res.concepts.map((c, i) => ({ ...c, id: `c-${Date.now()}-${i}` }));

      // 개선: 다른 추론을 골라 컨셉을 다시 만들 때, 세션을 통째로 복제해 history에 새로 push하지 않고
      // 같은 세션 내부의 "branches"로 이전 결과를 보존한다. (리포트/히스토리 중복 방지)
      if (session.selectedInferenceId && session.selectedInferenceId !== state.selectedInferenceId
          && session.concepts && session.concepts.length > 0) {
        const priorInferenceTitle = (session.inferences || []).find(i => i.id === session.selectedInferenceId)?.title || "이전 추론";
        const priorBranch = {
          inferenceTitle: priorInferenceTitle,
          perspective: session.perspective,
          concepts: session.concepts,
          selectedConceptId: session.selectedConceptId,
          selectedConcept: session.selectedConcept,
          scenario: session.scenario
        };
        session.branches = [...(session.branches || []), priorBranch];
      }

      session.selectedInferenceId = state.selectedInferenceId;
      session.perspective = perspective;
      session.concepts = conceptsWithId;
      session.selectedConceptId = null;
      session.scenario = "";
      session.selectedConcept = null;

      setState({ 
        currentConcepts: conceptsWithId, 
        step: 9, 
        selectedConceptId: null,
        history: newH
      });
    } else {
      showToast("컨셉 생성에 실패했습니다. 다시 시도해 주세요.");
    }
  },

  async generateScenario() {
    if (state.history.length === 0) return;
    const { newH, session } = cloneLastSession();
    const persona = getAllPersonas().find(p => p.id === session.personaId);
    const concept = state.currentConcepts.find(c => c.id === state.selectedConceptId);
    
    if(!concept) { showToast("컨셉을 선택해 주세요."); return; }

    const res = await callGemini(
      PROMPTS.GENERATE_SCENARIO(state.researchTopic, persona, concept), 
      "Generate Scenario"
    );
    if (res && res.scenario) {
      session.selectedConceptId = state.selectedConceptId;
      session.selectedConcept = concept;
      session.scenario = res.scenario;

      setState({ 
        currentScenario: res.scenario, 
        step: 10,
        history: newH
      });
    } else {
      showToast("시나리오 생성에 실패했습니다. 다시 시도해 주세요.");
    }
  }
};
window.Actions = Actions;

// --- LOCAL STORAGE MIGRATION ---
// 개선: 버전 키(_v31 등)가 바뀌어도 이전 버전의 저장 데이터를 잃지 않도록 마이그레이션
function migrateOldProjectsIfNeeded() {
  try {
    const current = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (current) return; // 이미 현재 키에 데이터가 있으면 마이그레이션 불필요

    const oldKeyPattern = /^research_lab_projects_v(\d+)$/;
    let bestKey = null, bestVersion = -1;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k === PROJECTS_STORAGE_KEY) continue;
      const m = k.match(oldKeyPattern);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v > bestVersion) { bestVersion = v; bestKey = k; }
      }
    }
    if (bestKey) {
      const oldData = localStorage.getItem(bestKey);
      if (oldData) {
        localStorage.setItem(PROJECTS_STORAGE_KEY, oldData);
        console.info(`이전 버전(${bestKey})의 프로젝트를 ${PROJECTS_STORAGE_KEY}로 이전했습니다.`);
      }
    }
  } catch (e) {
    console.error("마이그레이션 실패:", e);
  }
}

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
                <h4 class="font-extrabold text-[16px] text-slate-800 line-clamp-1">${esc(p.title)}</h4>
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
          <h4 class="font-extrabold text-[16px] text-slate-800 line-clamp-1">${esc(p.title)}</h4>
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
  let txt = "==================================================\n   RESEARCH LAB. 분석 종합 리포트 (누적 보존 모드)\n==================================================\n\n";
  txt += `[리서치 주제]\n- ${state.researchTopic || "설정된 주제 없음"}\n\n`;

  // 타겟 리스트 추가 부분
  if (state.aiCategories && state.aiCategories.length > 0) {
    txt += `==================================================\n`;
    txt += ` 제안된 핵심 인터뷰 타겟 리스트\n`;
    txt += `==================================================\n`;
    state.aiCategories.forEach(cat => {
      txt += `\n[${cat.categoryName}]\n`;
      cat.personas.forEach(p => {
        txt += `- ${p.name}\n  설명: ${p.description}\n  니즈: ${p.needs}\n\n`;
      });
    });
    if (state.manualPersonas && state.manualPersonas.length > 0) {
      txt += `\n[사용자 직접 추가 타겟]\n`;
      state.manualPersonas.forEach(p => {
        txt += `- ${p.name}\n  설명: ${p.description}\n\n`;
      });
    }
  }
  
  if (state.history.length > 0) {
    state.history.forEach((h, idx) => {
      const persona = getAllPersonas().find(p => p.id === h.personaId);
      txt += `==================================================\n`;
      txt += ` 분석 이력 세션 #${idx+1} : [타겟] ${persona?.name || "미지정"}\n`;
      txt += `==================================================\n`;
      
      if (h.result && h.result.summary) {
        txt += `[인터뷰 요약]\n${h.result.summary}\n\n`;
      }
      
      if (h.result && h.result.qaPairs && h.result.qaPairs.length > 0) {
        txt += `[대화 내용 (Q&A)]\n`;
        h.result.qaPairs.forEach((qa, qidx) => { 
          txt += `Q${qidx+1}: ${qa.q}\nA: ${qa.a}\n\n`; 
        });
      }
      
      if (h.result && h.result.keyInsights) {
        txt += `[AI Key Insights]\n${h.result.keyInsights}\n\n`;
      }

      if (h.userInsight) {
        txt += `[사용자 발견 인사이트]\n${h.userInsight}\n\n`;
      }

      if (h.inferences && h.inferences.length > 0) {
        txt += `[도출된 핵심 가치 추론 (${h.inferencePerspective || "종합적 관점"})]\n`;
        h.inferences.forEach((inf, i) => {
          const checkMark = (h.selectedInferenceId === inf.id) ? " ★(선택됨)" : "";
          txt += `${i+1}. ${inf.title}${checkMark}\n   ${inf.description}\n\n`;
        });
      }

      if (h.concepts && h.concepts.length > 0) {
        txt += `[도출된 디자인 컨셉 (${h.perspective || "종합적 관점"})]\n`;
        h.concepts.forEach((c, i) => {
          const checkMark = (h.selectedConceptId === c.id) ? " ★(최종 가설 채택)" : "";
          txt += `${i+1}. ${c.title}${checkMark}\n   핵심 가치: ${c.coreValue}\n   ${c.description}\n\n`;
        });
      }

      if (h.scenario) {
        txt += `[컨셉 시나리오 (${h.selectedConcept?.title || "채택된 가설"})]\n${h.scenario}\n\n`;
      }

      // 개선: 다른 관점으로 다시 탐색했던 분기 결과도 리포트에 포함 (예전엔 세션이 복제되어 중복 출력됨)
      if (h.branches && h.branches.length > 0) {
        h.branches.forEach((b, bi) => {
          txt += `--------------------------------------------------\n`;
          txt += `[분기 탐색 ${bi+1}] 추론: ${b.inferenceTitle} (${b.perspective || "종합적 관점"})\n`;
          txt += `--------------------------------------------------\n`;
          (b.concepts || []).forEach((c, i) => {
            const mark = (b.selectedConceptId === c.id) ? " ★(당시 채택)" : "";
            txt += `${i+1}. ${c.title}${mark}\n   핵심 가치: ${c.coreValue}\n   ${c.description}\n\n`;
          });
          if (b.scenario) txt += `시나리오: ${b.scenario}\n\n`;
        });
      }
      txt += `\n`;
    });
  } else {
    txt += "저장된 리서치 분석 기록이 존재하지 않습니다.\n";
  }
  
  const textArea = document.createElement("textarea");
  textArea.value = txt;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    showToast("모든 여정이 포함된 분석 종합 리포트가 복사되었습니다.");
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
  toast.innerText = message; // innerText 사용으로 이미 XSS 안전
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

// 신규: 상단 진행 단계 표시 (전체 10단계 중 현재 위치)
function renderStepDots(currentStep) {
  if (currentStep < 1 || currentStep > 10) return '';
  let dots = '';
  for (let i = 1; i <= 10; i++) {
    const active = i === currentStep;
    const done = i < currentStep;
    dots += `<div class="h-1.5 rounded-full transition-all ${active ? 'w-6 bg-blue-600' : (done ? 'w-3 bg-blue-300' : 'w-3 bg-slate-200')}"></div>`;
  }
  return `<div class="flex items-center gap-1.5 pb-2 pt-1">${dots}</div>`;
}

function renderHeader(title, prevStep) {
  const canGoNext = state.step < state.maxStepReached;
  return `
    <header class="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-slate-200/50 px-4 pt-2 pb-1 flex flex-col max-w-[430px] mx-auto">
      <div class="h-14 flex items-center justify-between w-full">
        <div class="flex items-center gap-1">
          <button onclick="setState({step: ${prevStep}})" class="p-2 -ml-2 rounded-full hover:bg-slate-100/80 transition-all text-slate-800">
            <i data-lucide="chevron-left" class="w-6 h-6"></i>
          </button>
          <h1 class="font-extrabold text-[17px] truncate ml-1 text-slate-900">${esc(title)}</h1>
        </div>
        <div class="flex items-center gap-1">
          ${canGoNext ? `<button onclick="setState({step: ${state.step + 1}})" class="p-2 rounded-full hover:bg-slate-100/80 text-slate-800 transition-all"><i data-lucide="chevron-right" class="w-6 h-6"></i></button>` : ""}
          <button onclick="copyReportToClipboard()" class="p-2 rounded-full hover:bg-slate-100/80 text-slate-800 transition-all"><i data-lucide="copy" class="w-5 h-5"></i></button>
          <button onclick="setState({step: 0})" class="p-2 rounded-full hover:bg-slate-100/80 text-slate-800 transition-all"><i data-lucide="home" class="w-5 h-5"></i></button>
        </div>
      </div>
      ${renderStepDots(state.step)}
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
            <p class="text-slate-900 text-[16px] leading-relaxed font-bold mb-3">프로젝트의 방향을 결정지을<br/>가장 핵심적인 인사이트를 도출해 드립니다.</p>
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
        <div class="pt-28 px-6 min-h-screen flex flex-col animate-fade-in bg-slate-50 topic-page">
          ${renderHeader("주제 설정", 0)}
          <div class="mb-8">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900 leading-snug">어떤 사용자 경험을<br/>개선하고 싶으신가요?</h2>
            <p class="text-slate-600 font-bold text-[15px]">해결하고자 하는 문제나 타겟 시장을 구체적으로 적어주시면 더 정확한 결과를 얻을 수 있습니다.</p>
          </div>
          <div class="relative bg-white rounded-3xl shadow-sm border border-slate-200 p-2 mb-20">
            <textarea id="topic-input" class="w-full h-64 p-5 bg-transparent border-none text-[17px] outline-none placeholder:text-slate-400 font-bold leading-relaxed resize-none text-slate-800" placeholder="예: 해외 여행 계획 시 정보의 파편화로 인해 피로도를 느끼는 1인 가구 직장인">${esc(state.researchTopic)}</textarea>
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-slate-50/90 backdrop-blur-lg border-t border-slate-200/50 max-w-[430px] mx-auto z-[60]">
            <button onclick="const val = document.getElementById('topic-input').value; if(val){ setState({researchTopic: val}); Actions.generatePersonas(); }" class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-md btn-active">타겟 12명 분석하기</button>
          </div>
        </div>`;
      break;

    case 2: // Personas (Grouped by Category)
      content += `
        <div class="pt-28 px-4 pb-36 animate-fade-in bg-slate-50 min-h-screen personas-page">
          ${renderHeader("타겟 제안", 1)}
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">핵심 인터뷰 타겟을 제안합니다</h2>
            <p class="text-blue-700 text-[16px] font-bold">4개 카테고리 타겟 General User, Lead User, Extreme User, Desire-Driven User</p>
          </div>
          
          <div class="space-y-12 mb-12 category-list px-2">
            ${state.aiCategories.map((cat, catIdx) => `
              <div class="space-y-4 category-item">
                <div class="bg-blue-100 border border-blue-200 p-5 rounded-3xl category-header">
                  <h3 class="font-black text-[18px] text-blue-900 mb-2 flex items-center gap-2">
                    <div class="w-2 h-6 bg-blue-600 rounded-full"></div> ${esc(cat.categoryName)}
                  </h3>
                  <p class="text-blue-800 font-bold text-[16px] leading-relaxed category-desc">${esc(cat.categoryDesc)}</p>
                </div>
                
                <div class="grid gap-4 persona-list">
                  ${cat.personas.map((p, i) => `
                    <div class="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden persona-card">
                      <button onclick="Actions.regeneratePersona(${catIdx}, ${i})" class="absolute top-4 right-4 p-2 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-lg transition-colors z-10" title="이 페르소나만 다시 생성">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                      </button>
                      <h4 class="font-black text-[20px] text-slate-900 mb-3 mt-0 pr-8 persona-name">${esc(p.name)}</h4>
                      <p class="text-[16px] text-slate-700 font-bold mb-5 leading-relaxed whitespace-pre-line persona-description">${esc(p.description)}</p>
                      <div class="bg-slate-50 px-4 py-4 rounded-2xl text-[16px] text-slate-700 font-bold border border-slate-200 needs-area">
                        <span class="font-extrabold text-blue-700 block mb-1">핵심 니즈</span>
                        ${esc(p.needs)}
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
                      <h4 class="font-black text-[20px] text-slate-900 mb-3 persona-name">${esc(p.name)}</h4>
                      <p class="text-[16px] text-slate-700 font-bold whitespace-pre-line persona-description">${esc(p.description)}</p>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <div class="space-y-4 mb-6 px-2 manual-persona-form">
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
        <div class="pt-28 px-4 pb-40 animate-fade-in bg-slate-50 min-h-screen select-persona-page">
          ${renderHeader("대상 선택", 2)}
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900 leading-snug">누구와 먼저<br/>대화를 나눌까요?</h2>
          </div>
          
          <div class="px-2 mb-6">
            ${state.aiCategories.map(cat => `
              <div class="mt-8 mb-4">
                <h3 class="font-extrabold text-[18px] text-slate-800 flex items-center gap-2">
                  <div class="w-1 h-5 bg-blue-600 rounded-full"></div> ${esc(cat.categoryName)}
                </h3>
              </div>
              <div class="grid gap-4">
                ${cat.personas.map((p, i) => {
                  const doneCount = state.history.filter(h => h.personaId === p.id).length;
                  const isSel = state.selectedPersonaId === p.id;
                  const clickHandler = doneCount > 0
                    ? `if(confirm('이 타겟은 이미 ${doneCount}회 인터뷰를 진행했습니다. 새로운 인터뷰를 다시 진행하시겠습니까? (기존 결과는 리포트에 그대로 남습니다)')) { setState({selectedPersonaId: '${p.id}', aiSurveys: [], manualSurveys: [], selectedQuestionIds: []}); }`
                    : `setState({selectedPersonaId: '${p.id}', aiSurveys: [], manualSurveys: [], selectedQuestionIds: []})`;
                  return `
                  <div onclick="${clickHandler}" 
                       class="p-5 rounded-[2rem] border-2 transition-all cursor-pointer persona-item ${isSel ? 'border-blue-600 bg-white shadow-lg scale-[1.02]' : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md'}">
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isSel ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'} font-black text-sm">
                          ${isSel ? '<i data-lucide="check" class="w-4 h-4"></i>' : (i + 1)}
                        </div>
                        <h3 class="font-extrabold text-[18px] text-slate-900 line-clamp-1">${esc(p.name)}</h3>
                      </div>
                      ${doneCount > 0 ? `<span class="text-[11px] font-extrabold px-2 py-1 bg-slate-300 text-slate-700 rounded-md">인터뷰 ${doneCount}회 · 재인터뷰 가능</span>` : ''}
                    </div>
                    <p class="text-[16px] text-slate-600 font-bold line-clamp-2 mt-2 pl-11">${esc(p.description)}</p>
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
                  const doneCount = state.history.filter(h => h.personaId === p.id).length;
                  const isSel = state.selectedPersonaId === p.id;
                  const clickHandler = doneCount > 0
                    ? `if(confirm('이 타겟은 이미 ${doneCount}회 인터뷰를 진행했습니다. 새로운 인터뷰를 다시 진행하시겠습니까? (기존 결과는 리포트에 그대로 남습니다)')) { setState({selectedPersonaId: '${p.id}', aiSurveys: [], manualSurveys: [], selectedQuestionIds: []}); }`
                    : `setState({selectedPersonaId: '${p.id}', aiSurveys: [], manualSurveys: [], selectedQuestionIds: []})`;
                  return `
                  <div onclick="${clickHandler}" 
                       class="p-5 rounded-[2rem] border-2 transition-all cursor-pointer persona-item ${isSel ? 'border-blue-600 bg-white shadow-lg scale-[1.02]' : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md'}">
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isSel ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'} font-black text-sm">
                          ${isSel ? '<i data-lucide="check" class="w-4 h-4"></i>' : '-'}
                        </div>
                        <h3 class="font-extrabold text-[18px] text-slate-900 line-clamp-1">${esc(p.name)}</h3>
                      </div>
                      ${doneCount > 0 ? `<span class="text-[11px] font-extrabold px-2 py-1 bg-slate-300 text-slate-700 rounded-md">인터뷰 ${doneCount}회 · 재인터뷰 가능</span>` : ''}
                    </div>
                    <p class="text-[16px] text-slate-600 font-bold line-clamp-2 mt-2 pl-11">${esc(p.description)}</p>
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
        <div class="pt-28 px-4 pb-36 animate-fade-in bg-slate-50 min-h-screen survey-page">
          ${renderHeader("질문 설계", 3)}
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">핵심 질문을<br/>골라주세요</h2>
            <p class="text-blue-700 text-[16px] font-extrabold">인터뷰의 뼈대가 될 질문들을 선택합니다. 연필 아이콘으로 문구를 직접 수정할 수도 있습니다.</p>
          </div>
          
          <div class="space-y-10 mb-6 px-2 survey-list">
            ${combinedSurveys.map(s => `
              <div class="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm survey-card">
                <h3 class="font-extrabold text-[18px] text-slate-900 mb-5 flex items-center gap-2 survey-title">
                  <div class="w-1.5 h-5 bg-blue-600 rounded-full"></div> ${esc(s.title)}
                </h3>
                <div class="space-y-3 question-list">
                  ${s.questions.map((q, idx) => {
                    const qId = `${s.id}-${idx}`; 
                    const isSel = state.selectedQuestionIds.includes(qId);
                    const isEditing = state.editingQuestionKey === qId;
                    if (isEditing) {
                      return `
                        <div class="p-4 rounded-2xl border-2 border-blue-400 bg-blue-50 flex gap-2 items-start question-item">
                          <textarea id="qedit-${qId}" class="flex-1 p-2 rounded-xl border border-blue-300 text-[15px] font-bold text-slate-900 outline-none resize-none" rows="2">${esc(q)}</textarea>
                          <button onclick="Actions.saveQuestionEdit('${qId}')" class="shrink-0 p-2 bg-blue-600 text-white rounded-xl"><i data-lucide="check" class="w-4 h-4"></i></button>
                        </div>`;
                    }
                    return `
                      <div class="p-4 rounded-2xl border-2 transition-all flex gap-3 items-start question-item ${isSel ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 bg-slate-50 hover:bg-slate-100'}">
                        <div onclick="toggleQuestion('${qId}')" class="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors cursor-pointer ${isSel ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'} text-white check-icon">
                          ${isSel ? `<i data-lucide="check" class="w-3.5 h-3.5"></i>` : ""}
                        </div>
                        <p onclick="toggleQuestion('${qId}')" class="text-[16px] cursor-pointer ${isSel ? 'text-blue-900 font-extrabold' : 'text-slate-700 font-bold'} flex-1 leading-snug question-text">${esc(q)}</p>
                        <button onclick="event.stopPropagation(); Actions.editQuestion('${qId}')" class="shrink-0 p-1.5 text-slate-400 hover:text-blue-600 transition-colors" title="질문 수정">
                          <i data-lucide="pencil" class="w-4 h-4"></i>
                        </button>
                      </div>`;
                  }).join('')}
                </div>
              </div>`).join('')}
          </div>
          
          <div class="bg-slate-200/60 p-6 mx-2 rounded-[2rem] border border-slate-300 space-y-4 mb-6 manual-question-form">
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
        <div class="pt-28 px-6 pb-44 animate-fade-in bg-slate-50 min-h-screen confirm-page">
          ${renderHeader("인터뷰 시작", 4)}
          <div class="mb-10 text-center mt-4 confirm-header">
            <div class="w-20 h-20 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm border border-blue-200 spinner-area">
               <i data-lucide="mic" class="w-10 h-10"></i>
            </div>
            <h2 class="text-2xl font-black tracking-tight text-slate-900 mb-2">인터뷰 준비 완료</h2>
            <p class="text-slate-600 font-bold text-[16px]">아래 대상과 가상 인터뷰를 진행합니다.</p>
          </div>
          
          <div class="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-md mb-6 persona-card">
            <div class="mb-6 border-b border-slate-200 pb-5 text-center persona-header">
              <h3 class="font-extrabold text-[22px] text-blue-900">${esc(selectedP?.name)}</h3>
            </div>
            <div class="space-y-4 max-h-72 overflow-y-auto pr-2 no-scrollbar font-bold question-list">
              ${finalQList.map((q, i) => `
                <div class="flex gap-3 text-[15px] bg-slate-50 p-4 rounded-2xl border border-slate-100 question-item">
                  <span class="font-black text-blue-600 shrink-0 select-none">Q${i+1}.</span> 
                  <p class="text-slate-800">${esc(q)}</p>
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

    case 6: // Step 6: Interview Progress
      const curSessionProgress = state.history[state.history.length-1];
      
      content += `
        <div class="pt-28 px-4 pb-[150px] animate-fade-in bg-slate-50 min-h-screen">
          ${renderHeader("인터뷰 진행", 5)}
          
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">가상의 인터뷰 대화를<br/>진행해 주세요</h2>
            <p class="text-blue-700 text-[16px] font-bold">타겟의 답변을 검토하고 추가 질문을 통해 인터뷰를 마무리합니다.</p>
          </div>

          <div class="space-y-6 mb-12 px-2">
            ${curSessionProgress.result.qaPairs.map((qa, i) => `
              <div class="p-6 rounded-[2rem] border-2 border-slate-200 bg-white shadow-sm">
                <div class="flex gap-3 mb-4 pr-8">
                  <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold flex items-center justify-center shrink-0 text-sm">Q${i+1}</div>
                  <div class="text-slate-900 font-extrabold text-[16px] leading-snug pt-1">${esc(qa.q)}</div>
                </div>
                <div class="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-slate-700 font-bold text-[16px] leading-relaxed">
                  ${esc(qa.a)}
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
        <div class="pt-28 px-4 pb-[380px] animate-fade-in bg-slate-50 min-h-screen">
          ${renderHeader("인터뷰 결과", 6)}
          
          <div class="mb-8 px-2">
            <h2 class="text-3xl font-black mb-3 tracking-tight text-slate-900">중요한 인사이트를<br/>선택해 주세요</h2>
            <p class="text-blue-700 text-[16px] font-bold">선택된 대화와 아래 직접 발견한 인사이트 내용을 바탕으로 컨셉이 도출됩니다.<br/>대화 내용은 여러 개 선택할 수 있습니다.</p>
          </div>

          <div class="mb-8 p-8 mx-2 bg-gradient-to-br from-blue-900 to-sky-950 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
            <div class="absolute top-0 right-0 w-32 h-32 bg-blue-500/30 blur-2xl rounded-full"></div>
            <div class="inline-block px-3 py-1 bg-white/20 rounded-full text-[11px] font-extrabold tracking-widest uppercase mb-4 border border-white/20">Summary</div>
            <h2 class="text-[26px] font-black mb-5 leading-tight text-white">${esc(getAllPersonas().find(p => p.id === lastH.personaId)?.name)}</h2>
            <p class="text-blue-50 text-[16px] leading-relaxed whitespace-pre-line font-bold opacity-90">${esc(lastH.result.summary)}</p>
          </div>
          
          <div class="flex items-center justify-between px-2 mb-3">
            <p class="text-[12px] text-slate-500 font-bold leading-snug flex-1 pr-2">💡 선택하지 않으면 전체 대화가 자동으로 반영됩니다.</p>
            <div class="flex gap-3 shrink-0">
              <button onclick="Actions.selectAllQa()" class="text-[12px] font-bold text-blue-600 underline">전체선택</button>
              <button onclick="Actions.clearQaSelection()" class="text-[12px] font-bold text-slate-400 underline">선택해제</button>
            </div>
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
                  <div class="text-slate-900 font-extrabold text-[16px] leading-snug pt-1">${esc(qa.q)}</div>
                </div>
                <div class="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-slate-700 font-bold text-[16px] leading-relaxed">
                  ${esc(qa.a)}
                </div>
              </div>`
            }).join('')}
          </div>
          
          <div class="bg-blue-600 p-6 mx-2 rounded-[2rem] mb-12 shadow-md shadow-blue-600/20 text-white">
            <h3 class="font-black text-[16px] uppercase tracking-wider mb-5 flex items-center gap-2">
              <i data-lucide="zap" class="w-5 h-5 text-yellow-300"></i> AI Key Insights
            </h3>
            <div class="text-blue-50 font-bold text-[15px] leading-relaxed whitespace-pre-line">${esc(lastH.result.keyInsights)}</div>
          </div>
          
          <div class="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-200 max-w-[430px] mx-auto z-[60] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
            <h4 class="text-[16px] font-extrabold text-slate-800 mb-3 flex items-center gap-2">
              <i data-lucide="lightbulb" class="w-5 h-5 text-amber-500"></i> 직접 발견한 인사이트 (필요시 입력)
            </h4>
            <textarea id="user-insight-input" onchange="Actions.updateUserInsight(this.value)" class="w-full p-4 bg-slate-50 border-2 border-blue-600 rounded-2xl text-[16px] h-32 outline-none focus:ring-2 focus:ring-blue-300 transition-all placeholder:text-slate-500 font-bold resize-none mb-4 text-slate-900" placeholder="인터뷰를 통해 느낀 점이나 아이디어를 적어주세요">${esc(state.userInsight)}</textarea>
            
            <button onclick="document.getElementById('user-insight-input').blur(); Actions.updateUserInsight(document.getElementById('user-insight-input').value); Actions.generateInferences()" class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-lg btn-active">
              핵심 가치 추론하기
            </button>
          </div>
        </div>`;
      break;

    case 8: { // Step 8: Inferences 도출
      const inferencePerspectives = ["종합적 관점", "독창성 관점", "기술적 관점", "비즈니스 관점"];
      content += `
        <div class="pt-28 px-4 pb-[300px] animate-fade-in bg-slate-50 min-h-screen">
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
                <h3 class="font-extrabold text-[18px] text-slate-900 mb-3 pr-8 leading-snug">${esc(inf.title)}</h3>
                <p class="text-slate-700 font-bold text-[16px] leading-relaxed whitespace-pre-line">${esc(inf.description)}</p>
              </div>`
            }).join('')}
          </div>

          <div class="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-200 max-w-[430px] mx-auto z-[60] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
            <div class="grid grid-cols-2 gap-2 mb-4">
              ${inferencePerspectives.map(p => {
                const isActive = state.currentPerspective === p;
                return `
                <button onclick="Actions.generateInferences('${p}')" class="py-3 rounded-xl font-bold text-[14px] border transition-all ${isActive ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}">
                  ${p}
                </button>`
              }).join('')}
            </div>
            <button onclick="Actions.generateConcepts()" ${!state.selectedInferenceId ? 'disabled' : ''} class="w-full h-14 bg-dark-blue hover:bg-dark-blue-hover text-white rounded-2xl font-bold text-[17px] shadow-lg btn-active">
              선택한 추론으로 디자인 컨셉 도출
            </button>
          </div>
        </div>`;
      break;
    }

    case 9: { // Design Concepts & Perspectives
      const perspectives = ["종합적 관점", "독창성 관점", "기술적 관점", "비즈니스 관점"];
      const currentSession = state.history[state.history.length - 1];
      
      let selectedQAs = currentSession.result.qaPairs.filter((_, i) => state.selectedQaIndices.includes(i));
      if(selectedQAs.length === 0) selectedQAs = currentSession.result.qaPairs;
      
      content += `
        <div class="pt-28 px-4 pb-[300px] animate-fade-in bg-slate-50 min-h-screen">
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
                <h3 class="font-extrabold text-[18px] text-slate-900 mb-2 pr-8 leading-snug">${esc(c.title)}</h3>
                <p class="font-extrabold text-blue-700 block mb-3 text-[14px]">핵심 가치: ${esc(c.coreValue)}</p>
                <p class="text-slate-700 font-bold text-[16px] leading-relaxed whitespace-pre-line">${esc(c.description)}</p>
              </div>`
            }).join('')}
          </div>

          ${currentSession.branches && currentSession.branches.length > 0 ? `
            <div class="mb-10 px-2">
              <h4 class="font-extrabold text-[15px] text-slate-500 uppercase tracking-wider mb-3">이전에 탐색한 다른 관점 (${currentSession.branches.length}개, 리포트에 전체 내용 포함됨)</h4>
              <div class="space-y-3">
                ${currentSession.branches.map(b => `
                  <div class="p-4 bg-slate-100 rounded-2xl border border-slate-200">
                    <p class="text-[13px] font-bold text-slate-500 mb-1">추론: ${esc(b.inferenceTitle)} · ${esc(b.perspective)}</p>
                    <p class="text-[15px] font-extrabold text-slate-800">${esc(b.selectedConcept?.title || (b.concepts && b.concepts[0]?.title) || '')}</p>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

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
    }

    case 10: // Concept Scenario
      content += `
        <div class="pt-28 px-6 pb-40 animate-fade-in bg-slate-50 min-h-screen">
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
              ${esc(state.currentScenario)}
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
let lastSavedSnapshot = null; // 개선: 변경된 것이 없으면 localStorage에 다시 쓰지 않음

function autosaveTick() {
  if (state.step > 0 || (state.step === 1 && state.researchTopic.trim() !== "")) {
    const { apiKey, isAnalyzing, errorMsg, editingQuestionKey, ...dataToSave } = state;
    const snapshot = JSON.stringify(dataToSave);
    if (snapshot === lastSavedSnapshot) return; // 변경 없음 -> 저장 스킵
    lastSavedSnapshot = snapshot;

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

    try {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    } catch (e) {
      console.error("저장 실패 (저장 공간 부족 가능성):", e);
      showToast("저장 공간이 부족하여 자동 저장에 실패했습니다.");
    }
  }
}

function initApp() {
  migrateOldProjectsIfNeeded();
  render();
  setInterval(autosaveTick, 5000);
}

initApp();
