CREATE TABLE public.sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '',
  total_amount numeric NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sale_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.sale_returns(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0
);

CREATE INDEX idx_sale_returns_sale ON public.sale_returns(sale_id);
CREATE INDEX idx_sale_returns_created_at ON public.sale_returns(created_at);
CREATE INDEX idx_sale_return_items_return ON public.sale_return_items(return_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_returns TO authenticated;
GRANT ALL ON public.sale_returns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_return_items TO authenticated;
GRANT ALL ON public.sale_return_items TO service_role;

ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read returns" ON public.sale_returns FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_returns.sale_id AND (s.sold_by = auth.uid() OR public.is_admin())));

CREATE POLICY "insert returns" ON public.sale_returns FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_returns.sale_id AND s.status <> 'voided' AND (s.sold_by = auth.uid() OR public.is_admin())));

CREATE POLICY "admin delete returns" ON public.sale_returns FOR DELETE TO authenticated
USING (public.is_admin());

CREATE POLICY "read return items" ON public.sale_return_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.sale_returns r JOIN public.sales s ON s.id = r.sale_id WHERE r.id = sale_return_items.return_id AND (s.sold_by = auth.uid() OR public.is_admin())));

CREATE POLICY "insert return items" ON public.sale_return_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.sale_returns r JOIN public.sales s ON s.id = r.sale_id WHERE r.id = sale_return_items.return_id AND (s.sold_by = auth.uid() OR public.is_admin())));

CREATE OR REPLACE FUNCTION public.apply_return_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_sale_id uuid;
  v_sold int;
  v_returned int;
begin
  select r.sale_id into v_sale_id from public.sale_returns r where r.id = new.return_id;

  if new.quantity <= 0 then
    raise exception 'Return quantity must be greater than zero';
  end if;

  select coalesce(sum(si.quantity),0) into v_sold
  from public.sale_items si
  where si.sale_id = v_sale_id and si.product_id = new.product_id;

  select coalesce(sum(ri.quantity),0) into v_returned
  from public.sale_return_items ri
  join public.sale_returns r on r.id = ri.return_id
  where r.sale_id = v_sale_id and ri.product_id = new.product_id and ri.id <> new.id;

  if v_sold = 0 then
    raise exception 'This product was not sold on that sale';
  end if;

  if v_returned + new.quantity > v_sold then
    raise exception 'Cannot return more than was sold (sold %, already returned %)', v_sold, v_returned;
  end if;

  insert into public.inventory (product_id, quantity) values (new.product_id, new.quantity)
    on conflict (product_id) do update set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

  insert into public.stock_movements (product_id, change_type, quantity_change, note, created_by)
    values (new.product_id, 'return', new.quantity, 'Return '||new.return_id, auth.uid());

  return new;
end; $$;

CREATE TRIGGER trg_apply_return_item
AFTER INSERT ON public.sale_return_items
FOR EACH ROW EXECUTE FUNCTION public.apply_return_item();

CREATE OR REPLACE FUNCTION public.sync_return_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  update public.sale_returns r
  set total_amount = (
    select coalesce(sum(ri.quantity * ri.unit_price),0)
    from public.sale_return_items ri where ri.return_id = r.id
  )
  where r.id = new.return_id;
  return new;
end; $$;

CREATE TRIGGER trg_sync_return_total
AFTER INSERT ON public.sale_return_items
FOR EACH ROW EXECUTE FUNCTION public.sync_return_total();