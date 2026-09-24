import { Sparkles } from 'lucide-react'
import type { Provider } from '../../shared/types'
import hamsterLogo from '../assets/hamster-logo-256.png'

export function EmptyState({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Sparkles />
      </div>
      <h1>开始使用 Hamster Studio</h1>
      <p>配置一个自定义 OpenAI Compatible 中转站，然后开始聊天或生成图片。</p>
      <button onClick={onSettings}>配置 Provider</button>
    </div>
  )
}
export function Welcome({
  provider,
  onPrompt,
}: {
  provider?: Provider
  onPrompt: (prompt: string) => void
}) {
  const suggestions = ['帮我整理一个三步计划', '写一段简洁的产品介绍', '生成一张极简风格海报']
  return (
    <div className="welcome">
      <img src={hamsterLogo} className="welcome-logo" />
      <h2>有什么可以帮你？</h2>
      <p>
        {provider
          ? '当前使用 ' + provider.name + '，你的 API Key 只保存在本机。'
          : '请先配置一个 Provider。'}
      </p>
      <div className="suggestions">
        {suggestions.map((item) => (
          <button key={item} onClick={() => onPrompt(item)}>
            {item}
          </button>
        ))}
      </div>
    </div>
  )
}
