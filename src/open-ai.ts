import {OpenAI} from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // добавьте ваш API ключ сюда
})

export const gptGPTResponse = async (prompt: string) => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 100,
    temperature: 0.7,
    messages: [{
      role: 'user',
      content: `You are a movie and TV series search assistant. Based on the user's query: "${prompt}", suggest the best possible movie or series titles for a torrent search query. 
Always prioritize well-known titles or the most fitting ones.`
    }],
  })

  return response.choices[0].message?.content ?? 'Нет ответа'
}
