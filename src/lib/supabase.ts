import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ViteではVITE_で始まる環境変数だけがブラウザ用コードへ公開されます。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/**
 * URLと公開キーがそろっている場合だけクライアントを生成します。
 * service_roleキーはRLSを迂回するため、ここでは絶対に使用しません。
 */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          // ログイン状態をブラウザに保存し、再読み込み後も運営操作を継続できるようにします。
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

/** 環境変数の設定漏れを画面上で分かりやすく案内するための判定値です。 */
export const isSupabaseConfigured = supabase !== null;

/** 未設定状態でDB操作を実行しないよう、共通の入口で検査します。 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error("Supabaseの接続情報が未設定です。VITE_SUPABASE_URLとVITE_SUPABASE_ANON_KEYを設定してください。");
  }
  return supabase;
}
