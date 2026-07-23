import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import { YoutubeTranscript } from 'youtube-transcript';

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['application/sdp', 'text/plain'], limit: '2mb' }));
app.use(express.static('public'));

const baseCoach = `Você é Fala, uma parceira brasileira de conversação para uma estudante americana que fará pesquisa em São Paulo sobre IA, infraestrutura urbana, vigilância, políticas públicas, Smart Sampa e USP/C4AI.

REGRAS:
- Converse por voz em português brasileiro. Não peça para a usuária digitar.
- Seja natural, calorosa mas não infantil; soe como uma jovem pesquisadora de São Paulo.
- Faça perguntas curtas e mantenha a usuária falando pelo menos 60% do tempo.
- Introduza no máximo 2 expressões novas por vez e reutilize-as em 3 contextos posteriores.
- Corrija apenas erros importantes ou ligados às expressões-alvo. Modele a forma correta rapidamente e continue.
- Quando ela travar, simplifique, dê uma pista em português e espere. Use inglês somente quando ela pedir explicitamente.
- Treine estratégias: “Pode repetir?”, “Mais devagar, por favor”, “O que quer dizer...?”, “Como se diz...?”.
- Aumente gradualmente a velocidade e naturalidade.
- Misture: vida diária em São Paulo, networking acadêmico, reuniões, entrevistas, apresentação do projeto, perguntas técnicas, ética e governança.
- Nunca dê uma aula longa. Uma frase de feedback, depois outra pergunta.
- No início, cumprimente-a, explique em uma frase que a sessão será somente falada e faça uma pergunta fácil.
`;

app.post('/session', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(500).send('OPENAI_API_KEY is not configured.');
  const extra = req.query.context ? decodeURIComponent(String(req.query.context)).slice(0, 10000) : '';
  const session = {
    type: 'realtime',
    model: 'gpt-realtime-2.1',
    reasoning: { effort: 'low' },
    instructions: baseCoach + (extra ? `\nCONTEÚDO DA SESSÃO (extraído de vídeo):\n${extra}` : ''),
    audio: {
      input: { turn_detection: { type: 'semantic_vad', eagerness: 'medium', create_response: true, interrupt_response: true } },
      output: { voice: 'marin' }
    }
  };
  const fd = new FormData();
  fd.set('sdp', req.body);
  fd.set('session', JSON.stringify(session));
  const safetyId = crypto.createHash('sha256').update(req.ip || 'local-user').digest('hex');
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'OpenAI-Safety-Identifier': safetyId },
      body: fd
    });
    const body = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/sdp').send(body);
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not create voice session.');
  }
});

app.post('/api/youtube', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'YouTube URL required.' });
  try {
    const parts = await YoutubeTranscript.fetchTranscript(url, { lang: 'pt' }).catch(() => YoutubeTranscript.fetchTranscript(url));
    const transcript = parts.map(x => x.text).join(' ').replace(/\s+/g, ' ').slice(0, 45000);
    if (!transcript) throw new Error('No captions found');

    const prompt = `Analise esta transcrição de um vídeo em português brasileiro para prática oral. Retorne SOMENTE JSON válido com esta estrutura:
{"summary_pt":"resumo simples em português","phrases":[{"pt":"expressão exata ou natural","en":"tradução curta","use":"quando usar"}],"questions":["pergunta oral 1"],"context":"instruções compactas para um tutor de voz"}
Selecione 6 expressões úteis, frequentes e reutilizáveis, não palavras isoladas. Crie 5 perguntas de conversação do fácil ao avançado. O contexto deve dizer para discutir o vídeo, ensinar duas expressões por vez e reciclar as anteriores.

TRANSCRIÇÃO:\n${transcript}`;

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.4-mini', input: prompt, text: { format: { type: 'json_object' } } })
    });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const text = data.output_text || data.output?.flatMap(o => o.content || []).find(c => c.type === 'output_text')?.text;
    const lesson = JSON.parse(text);
    res.json({ lesson, transcriptLength: transcript.length });
  } catch (err) {
    console.error(err);
    res.status(422).json({ error: 'Could not read captions. The video may not have accessible captions.', detail: String(err.message || err) });
  }
});

app.listen(port, () => console.log(`Fala PT running at http://localhost:${port}`));
