/**
 * Push notifications go through Expo's service, which owns the APNs key uploaded to
 * EAS credentials. The deep link is what makes the notification useful: tapping it
 * opens the finished sticker even from a cold start.
 */

export interface StickerReadyPush {
  pushToken: string;
  generationId: string;
  locale: string;
  failed?: boolean;
}

const TITLES: Record<string, string> = {
  en: 'Your sticker is ready',
  ru: 'Стикер готов',
  es: 'Tu sticker está listo',
  fr: 'Ton sticker est prêt',
  de: 'Dein Sticker ist fertig',
  pt: 'Seu sticker está pronto',
};

const FAILED_TITLES: Record<string, string> = {
  en: 'Generation failed',
  ru: 'Не удалось создать стикер',
  es: 'La generación falló',
  fr: 'La génération a échoué',
  de: 'Erstellung fehlgeschlagen',
  pt: 'A geração falhou',
};

const BODIES: Record<string, string> = {
  en: 'Tap to see it and add it to a pack.',
  ru: 'Откройте, чтобы посмотреть и добавить в пак.',
  es: 'Toca para verlo y añadirlo a un pack.',
  fr: 'Touche pour le voir et l’ajouter à un pack.',
  de: 'Tippe, um ihn zu sehen und zu einem Pack hinzuzufügen.',
  pt: 'Toque para ver e adicionar a um pacote.',
};

function pick(map: Record<string, string>, locale: string): string {
  const short = locale.split('-')[0] ?? 'en';
  return map[short] ?? map.en ?? '';
}

export async function sendStickerReadyPush(payload: StickerReadyPush): Promise<void> {
  const titles = payload.failed ? FAILED_TITLES : TITLES;

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: payload.pushToken,
        title: pick(titles, payload.locale),
        body: payload.failed ? '' : pick(BODIES, payload.locale),
        sound: 'default',
        badge: 1,
        data: {
          type: 'sticker_ready',
          generationId: payload.generationId,
          url: `stickers://generation/${payload.generationId}`,
        },
      }),
    });
    if (!response.ok) {
      console.error('expo push rejected', response.status, await response.text());
    }
  } catch (error) {
    // A failed push must never fail the generation: Realtime already updated the UI.
    console.error('expo push error', error);
  }
}
