import type { Chronicle, Digest } from '../chronicle/chronicle';
import type { PublishInput } from '../harbor/client';
import type { InscriptionId } from '../harbor/contract';

/**
 * 出港の 1 クリック (M19-09)。判定の板の「出港する」と台本が、判定の瞬間の年代記と要約に、碑文のカタログから選んだひとことを添えて港へ出す
 */
export const publishClick = (island: { chronicle: Chronicle; digest: Digest }, inscription: InscriptionId): PublishInput => ({ chronicle: island.chronicle, digest: island.digest, inscription });
