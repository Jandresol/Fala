import path from 'node:path';

const DEFAULT_PIPER_VOICE = path.join(process.cwd(), 'models/piper/voices/pt_BR-faber-medium.onnx');

export const SUPPORTED_LANGUAGES = [
  {
    id: 'pt-BR',
    label: 'Portuguese',
    nativeLabel: 'Português',
    code: 'pt-BR',
    whisperLanguage: 'pt',
    captionLangs: 'pt.*,pt',
    targetLanguage: 'português brasileiro',
    targetLanguageEnglishName: 'Brazilian Portuguese',
    supportLanguage: 'English',
    fallbackSpeak: 'Desculpa, você pode repetir?',
    piperVoice: process.env.PIPER_VOICE_PT_BR || process.env.PIPER_VOICE || DEFAULT_PIPER_VOICE,
  },
  {
    id: 'fr-FR',
    label: 'French',
    nativeLabel: 'Français',
    code: 'fr-FR',
    whisperLanguage: 'fr',
    captionLangs: 'fr.*,fr',
    targetLanguage: 'français',
    targetLanguageEnglishName: 'French',
    supportLanguage: 'English',
    fallbackSpeak: 'Pardon, vous pouvez répéter?',
    piperVoice: process.env.PIPER_VOICE_FR_FR || process.env.PIPER_VOICE || DEFAULT_PIPER_VOICE,
  },
  {
    id: 'en-US',
    label: 'English Test',
    nativeLabel: 'English',
    code: 'en-US',
    whisperLanguage: 'en',
    captionLangs: 'en.*,en',
    targetLanguage: 'English',
    targetLanguageEnglishName: 'English',
    supportLanguage: 'English',
    fallbackSpeak: 'Sorry, could you repeat that?',
    piperVoice: process.env.PIPER_VOICE_EN_US || process.env.PIPER_VOICE || DEFAULT_PIPER_VOICE,
  },
];

export const LANGUAGE = {
  code: process.env.FALA_LANGUAGE_CODE || 'pt-BR',
  whisperLanguage: process.env.WHISPER_LANG || 'pt',
  captionLangs: process.env.YOUTUBE_CAPTION_LANGS || 'pt.*,pt',
  targetLanguage: process.env.FALA_TARGET_LANGUAGE || 'português brasileiro',
  targetLanguageEnglishName: process.env.FALA_TARGET_LANGUAGE_EN || 'Brazilian Portuguese',
  supportLanguage: process.env.FALA_SUPPORT_LANGUAGE || 'English',
  fallbackSpeak: process.env.FALA_FALLBACK_SPEAK || 'Sorry, could you repeat that?',
  piperVoice: process.env.PIPER_VOICE || DEFAULT_PIPER_VOICE,
};

export function languageById(id) {
  return SUPPORTED_LANGUAGES.find(language => language.id === id) || SUPPORTED_LANGUAGES[0];
}

export function applyLanguage(id) {
  Object.assign(LANGUAGE, languageById(id));
  return LANGUAGE;
}
