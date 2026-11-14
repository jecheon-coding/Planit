// 카테고리 규칙: #해시태그(명시) → 키워드 사전(추론) 순서.

export const CATEGORY_ALIASES = {
  work: ['업무', '회사', '일', 'work'],
  personal: ['개인', '생활', 'personal', 'life'],
  study: ['학습', '공부', 'study'],
};

export const CATEGORY_KEYWORDS = {
  work: ['회의', '미팅', '보고', '출장', '업무', '프로젝트', '발표', '클라이언트', '고객', '결재', '기획', '리뷰', '스탠드업', '야근', '회식'],
  study: ['공부', '강의', '스터디', '시험', '학습', '과제', '수업', '독서', '복습', '예습', '인강', '세미나', '자격증', '알고리즘', '코딩테스트'],
  personal: ['약속', '운동', '병원', '치과', '헬스', '요가', '생일', '가족', '친구', '데이트', '쇼핑', '장보기', '여행', '미용실', '산책', '은행'],
};

/** 알려진 카테고리의 #태그를 찾아 소비하고 categoryId 반환 */
export function extractHashtag(ctx, categories) {
  for (const m of ctx.rest.matchAll(/#([^\s#]+)/g)) {
    const tag = m[1].toLowerCase();
    const cat = categories.find((c) =>
      c.name.toLowerCase() === tag
      || c.id.toLowerCase() === tag
      || (CATEGORY_ALIASES[c.id] ?? []).includes(tag));
    if (cat) {
      ctx.consume(m.index, m[0].length, 'category');
      return cat.id;
    }
  }
  return null;
}

/** 텍스트에서 가장 앞에 나오는 키워드의 카테고리 반환 (없으면 null) */
export function inferCategory(text, categories) {
  let best = null;
  for (const cat of categories) {
    for (const kw of CATEGORY_KEYWORDS[cat.id] ?? []) {
      const idx = text.indexOf(kw);
      if (idx !== -1 && (!best || idx < best.idx)) best = { id: cat.id, idx };
    }
  }
  return best?.id ?? null;
}
