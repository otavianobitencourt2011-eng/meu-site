// netlify/functions/organizar-metas.js
//
// Proxy server-side para a Hugging Face Inference API.
// O navegador chama ESTA function (mesma origem do site, sem CORS),
// e ela chama a Hugging Face por trás — servidor-para-servidor não
// tem bloqueio de CORS, e o token nunca aparece no código do navegador.
//
// Configuração necessária no Netlify:
// Site settings → Environment variables → adicionar HF_TOKEN com o valor do seu token.

const HF_MODEL = "microsoft/phi-2";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Método não permitido" }) };
  }

  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "HF_TOKEN não configurado nas variáveis de ambiente do Netlify." }),
    };
  }

  let metas;
  try {
    const body = JSON.parse(event.body || "{}");
    metas = body.metas;
    if (!Array.isArray(metas)) throw new Error("Campo 'metas' ausente ou inválido.");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Body inválido: " + e.message }) };
  }

  const prompt = `Analise estas metas financeiras e faça as seguintes correções:

1. Se o nome for genérico (ex: "meta", "objetivo", "sonho", "coisa", "guardar", "juntar", ou vazio), renomeie para "Meta #1", "Meta #2", etc. na ordem em que aparecem.

2. Se o prazo (meses) for maior que 80, substitua por 12 meses.

3. Se o valor já guardado for igual ou maior que o valor total, marque como concluida (concluida: true).

Retorne APENAS um JSON com o array de metas corrigidas no mesmo formato.

Metas atuais:
${JSON.stringify(metas, null, 2)}

Resposta em JSON:`;

  try {
    const hfResponse = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 1000,
          temperature: 0.1,
          return_full_text: false,
        },
        options: { wait_for_model: true },
      }),
    });

    const raw = await hfResponse.text();

    if (!hfResponse.ok) {
      return {
        statusCode: hfResponse.status,
        body: JSON.stringify({ error: `Erro da Hugging Face (${hfResponse.status}): ${raw}` }),
      };
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Resposta da Hugging Face não é JSON: " + raw.slice(0, 500) }),
      };
    }

    const respostaTexto = data[0]?.generated_text || data?.generated_text || "";
    if (!respostaTexto) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "A IA não retornou texto.", raw: data }),
      };
    }

    const jsonMatch = respostaTexto.match(/\{[\s\S]*\}/) || respostaTexto.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "A IA não respondeu em formato JSON.", textoRecebido: respostaTexto }),
      };
    }

    let metasOrganizadas;
    try {
      metasOrganizadas = JSON.parse(jsonMatch[0]);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "JSON retornado pela IA está malformado.", trecho: jsonMatch[0] }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metas: metasOrganizadas }),
    };
  } catch (erro) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Falha ao chamar a Hugging Face: " + (erro.message || String(erro)) }),
    };
  }
};

