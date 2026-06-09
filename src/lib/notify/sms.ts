import axios from 'axios'

export async function sendSms(receiver: string, message: string) {
  const params = new URLSearchParams({
    key: process.env.ALIGO_KEY!,
    user_id: process.env.ALIGO_USER_ID!,
    sender: process.env.ALIGO_SENDER!,
    receiver,
    msg: message,
    msg_type: 'SMS',
  })

  const response = await axios.post('https://apis.aligo.in/send/', params)
  return response.data
}
