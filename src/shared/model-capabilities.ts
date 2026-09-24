export type ModelKind = 'chat' | 'image'

const imageModelPattern = /image|dall[-_ ]?e|imagen|flux|sdxl/i

export function modelKind(model: string): ModelKind {
  return imageModelPattern.test(model) ? 'image' : 'chat'
}

export function classifyModels(models: string[]) {
  const chatModels: string[] = []
  const imageModels: string[] = []
  for (const model of models.map((item) => item.trim()).filter(Boolean)) {
    ;(modelKind(model) === 'image' ? imageModels : chatModels).push(model)
  }
  return { chatModels: [...new Set(chatModels)], imageModels: [...new Set(imageModels)] }
}
