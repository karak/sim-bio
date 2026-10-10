/**
 * 訪問の 1 クリック (M19-09)。出港のリンク・一覧のカード・台本が同じ道を開く。
 * 石板を道に載せるので、main.ts は港に問い合わせる前に、その石板の島を普段どおりに組める (起動が港に頼らない)
 */
export const visitHref = (card: { id: string; scenarioId: string }): string => `/?${new URLSearchParams({ scenario: card.scenarioId, visit: card.id })}`;
