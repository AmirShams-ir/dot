import * as dnsPacket from 'dns-packet'
import { Buffer } from 'buffer'

const DOH_ADDRESS = "cloudflare-dns.com/dns-query"

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { pathname, search } = url

    if (pathname == "/") {
      return new Response(`200 OK`, { status: 200 })
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response(`Method ${request.method} not allowed.`, { status: 405 })
    }

    // Get the client's IP address from the request headers
    const clientIp = request.headers.get('CF-Connecting-IP')

    if (!clientIp) {
      throw new Error('Client IP not found in request headers')
    }

    // Determine the source prefix length based on the IP address type
    const sourcePrefixLength = clientIp.includes(':') ? 48 : 24

    // Parse the DNS packet from the request body
    const body = await request.clone().arrayBuffer()
    const dnsMsg = dnsPacket.decode(Buffer.from(body))

    // Create an EDNS Client Subnet option
    const ecsOption = {
      code: 'CLIENT_SUBNET',
      ip: clientIp,
      sourcePrefixLength: sourcePrefixLength,
      scopePrefixLength: 0
    }

    // Add the EDNS option to the DNS packet
    dnsMsg.additionals.push({
      type: 'OPT',
      name: '.',
      udpPayloadSize: 4096,
      options: [ecsOption]
    })

    // Enable DNSSEC by setting the DO flag
    dnsMsg.flags |= (1 << 15)

    // Encode the modified DNS packet back into the request body
    const modifiedBody = dnsPacket.encode(dnsMsg)

    const newURL = `https://${DOH_ADDRESS}`
    const newRequest = new Request(newURL, {
      body: modifiedBody,
      headers: request.headers,
      method: request.method,
      redirect: request.redirect
    })

    return await fetch(newRequest)
  },
}
