// deno-lint-ignore-file

import serviceAccount from '../service-account.json' assert { type: 'json' };
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import {
  getToken,
  GoogleAuth,
} from 'https://deno.land/x/googlejwtsa@v0.1.8/mod.ts';

enum NotificationType {
  EVENT = 'EVENT',
  ORDER = 'ORDER',
  PRODUCT = 'PRODUCT',
}

interface Notifications {
  id: string;
  account_id: string;
  role_id: string;
  type: NotificationType;
  notification_detail_id: string;
  created_at: string;
  body: string;
}

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: Notifications;
  schema: 'public';
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  const payload: WebhookPayload = await req.json();

  let fcmTokens: string[] = [];
  if (!!payload.record.account_id) {
    const { data, error } = await supabase
      .from('Token')
      .select('token')
      .match({
        account_id: payload.record.account_id,
        type: 'FCM_TOKEN',
      })
      .single();
    if (!data) throw new Error(error.message);

    fcmTokens.push(data.token);
  } else {
    const { data, error } = await supabase.from('Token').select('token').match({
      'account.role_id': payload.record.role_id,
      type: 'FCM_TOKEN',
    });
    if (!data) throw new Error(error.message);

    data.forEach((token) => fcmTokens.push(token.token));
  }

  const googleServiceAccountCredentials = JSON.stringify(serviceAccount);
  const accessToken = await getAccessToken(googleServiceAccountCredentials);

  const result = await Promise.all(
    fcmTokens.map(async (fcmToken) => {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token: fcmToken,
              notification: {
                title: `Clothy Notification`,
                body: payload.record.body,
              },
              data: {
                type: payload.record.type,
                notification_detail_id: payload.record.notification_detail_id,
                created_at: payload.record.created_at,
              },
            },
          }),
        }
      );

      const resData = await res.json();

      if (res.status < 200 || 299 < res.status) {
        throw resData;
      }

      return resData;
    })
  );

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});

const getAccessToken = async (credentials: string): Promise<string> => {
  const googleAuthOptions = {
    scope: ['https://www.googleapis.com/auth/firebase.messaging'],
  };

  const token: GoogleAuth = await getToken(credentials, googleAuthOptions);
  return token.access_token;
};
