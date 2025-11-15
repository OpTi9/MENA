import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { recipient, donor, signature } = req.body;

    if (!recipient || !donor || !signature) {
      return res.status(400).json({
        error: 'Missing required parameters',
        received: { recipient: !!recipient, donor: !!donor, signature: !!signature }
      });
    }

    // Validate parameters
    if (typeof recipient !== 'string' || typeof donor !== 'string' || typeof signature !== 'string') {
      return res.status(400).json({
        error: 'Invalid parameter types',
        expected: { recipient: 'string', donor: 'string', signature: 'string' }
      });
    }

    const url = `https://scavenger.prod.gd.midnighttge.io/donate_to/${encodeURIComponent(recipient)}/${encodeURIComponent(donor)}/${signature}`;

    console.log('Making request to:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ScavengerMine-Consolidation-Tool/1.0'
      },
      body: '{}'
    });

    const responseText = await response.text();

    // Try to parse as JSON first, fall back to text
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    console.log('Response status:', response.status);
    console.log('Response data:', responseData);

    res.status(response.status);

    const contentType = response.headers.get('Content-Type') || 'application/json';
    res.setHeader('Content-Type', contentType);

    return res.send(responseText);

  } catch (error) {
    console.error('API Error:', error);

    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}