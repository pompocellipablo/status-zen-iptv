<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep reseller pricing and credit-sale snapshots in separate authenticated tables and a separate protected route; historical margins must survive changes to a reseller's current price and must not mix with client revenue.
- Reuse financial_due_date as prepaid-month credit: overdue renewals anchor both dates to the payment day, early renewals anchor to existing service due date, and payments record revenue only once; this keeps monthly service cycles separate from prepaid coverage.
- Store regular and overdue WhatsApp templates in authenticated settings and choose by computed due-date status; the message stays editable without changing client records.
- Apply database changes through the managed migration tool and retain its generated Drizzle journal; historical SQL files remain immutable so recorded schema history stays consistent.
