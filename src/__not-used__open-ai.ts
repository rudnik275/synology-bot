import {OpenAI} from 'openai'

const __notUsed__openAi = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // добавьте ваш API ключ сюда
})

export const filterSearchResultsByAi = async (query: string, results: any[]) => {
  const response = await __notUsed__openAi.chat.completions.create({
    model: 'gpt-4-turbo',
    temperature: 0.3,
    messages: [{
      role: 'user',
      content: `Ты помощник по поиску фильма или сериала.
      Юзер на торренте ввел запрос - "${query}". 
      Формат результатов поиска - {title: string, url: string}[].
      Ты фильтруешь массив по title.
      Твоя задача отфильтровать массив оставь только те элементы которые соответствуют запросу пользователя. 
      Результат должен быть валидный массив {title: string, url: string}[], без дополнительных символов, так как я буду прогонять через JSON.parse.
      Результаты поиска: ${JSON.stringify(results)}.`
    }],
  })

  console.log(response.choices[0].message?.content)

  return JSON.parse(response.choices[0].message?.content || '[]')
}
