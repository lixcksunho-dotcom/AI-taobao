import axios from 'axios'

interface KakaoNotifyParams {
  receiver: string
  templateCode: string
  variables: Record<string, string>
}

export async function sendKakaoAlimtalk({ receiver, templateCode, variables }: KakaoNotifyParams) {
  const params = new URLSearchParams({
    key: process.env.ALIGO_KEY!,
    user_id: process.env.ALIGO_USER_ID!,
    senderkey: process.env.ALIGO_SENDER!,
    tpl_code: templateCode,
    sender: process.env.ALIGO_SENDER!,
    receiver_1: receiver,
    ...Object.fromEntries(
      Object.entries(variables).map(([k, v]) => [`#{${k}}`, v])
    ),
  })

  const response = await axios.post('https://kakaoapi.aligo.in/akv10/alimtalk/send/', params)
  return response.data
}
